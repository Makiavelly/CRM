package main

import (
	"bufio"
	"crypto/rand"
	"crypto/subtle"
	"crypto/tls"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/http"
	"net/mail"
	"net/smtp"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"
	_ "modernc.org/sqlite"
)

type app struct {
	db       *sql.DB
	sessions map[string]int64
	mu       sync.RWMutex
	mail     emailConfig
}

type emailConfig struct {
	Host string
	Port string
	User string
	Pass string
	From string
}

type contextKey string

const userKey contextKey = "user"

type User struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
	Name      string `json:"name"`
}

func main() {
	loadEnvFile(".env")

	db, err := openDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db, sessions: map[string]int64{}, mail: loadEmailConfig()}
	if err := a.initDB(); err != nil {
		log.Fatal(err)
	}
	go a.startEmailReminderWorker()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/", a.handleAPI)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}
	log.Printf("CRM Go API listening on http://127.0.0.1:%s", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, withCORS(mux)))
}

func openDB() (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Join("server", "data"), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join("server", "data", "sales_crm.db"))
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		return nil, err
	}
	return db, nil
}

func loadEmailConfig() emailConfig {
	port := os.Getenv("SMTP_PORT")
	if port == "" {
		port = "587"
	}
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = os.Getenv("SMTP_USER")
	}
	return emailConfig{
		Host: os.Getenv("SMTP_HOST"),
		Port: port,
		User: os.Getenv("SMTP_USER"),
		Pass: os.Getenv("SMTP_PASS"),
		From: from,
	}
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("failed to read %s: %v", path, err)
		}
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key != "" {
			_ = os.Setenv(key, value)
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("failed to parse %s: %v", path, err)
	}
}

func (cfg emailConfig) enabled() bool {
	return cfg.Host != "" && cfg.Port != "" && cfg.User != "" && cfg.Pass != "" && cfg.From != ""
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) handleAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api")
	if path == "" {
		path = "/"
	}

	if r.Method == http.MethodGet && path == "/health" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	switch {
	case r.Method == http.MethodPost && path == "/auth/register":
		a.register(w, r)
	case r.Method == http.MethodPost && path == "/auth/login":
		a.login(w, r)
	default:
		user, ok := a.authUser(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "Нужна авторизация")
			return
		}
		a.handleAuthed(w, r, path, user)
	}
}

func (a *app) handleAuthed(w http.ResponseWriter, r *http.Request, path string, user User) {
	switch {
	case r.Method == http.MethodPost && path == "/auth/logout":
		a.logout(w, r)
	case r.Method == http.MethodGet && path == "/auth/me":
		projects, err := a.listProjects(user)
		writeResult(w, map[string]any{"user": user, "projects": projects}, err)
	case r.Method == http.MethodGet && path == "/projects":
		projects, err := a.listProjects(user)
		writeResult(w, projects, err)
	case r.Method == http.MethodPost && path == "/projects":
		a.createProject(w, r, user)
	case strings.HasPrefix(path, "/projects/"):
		a.handleProjectRoutes(w, r, path, user)
	case strings.HasPrefix(path, "/clients/"):
		a.handleClientRoutes(w, r, path, user)
	case strings.HasPrefix(path, "/notes/") && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		a.updateNoteByPath(w, r, path, user)
	case strings.HasPrefix(path, "/notes/") && r.Method == http.MethodDelete:
		a.deleteNoteByPath(w, path, user)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/interactions/") && strings.HasSuffix(path, "/complete"):
		a.completeInteraction(w, path, user)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/interactions/"):
		a.deleteInteraction(w, path, user)
	case r.Method == http.MethodGet && path == "/notifications":
		rows, err := a.queryMaps("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", user.ID)
		writeResult(w, rows, err)
	case r.Method == http.MethodPost && path == "/notifications/read-all":
		_, err := a.db.Exec("UPDATE notifications SET is_read = 1 WHERE user_id = ?", user.ID)
		writeResult(w, map[string]bool{"ok": true}, err)
	case r.Method == http.MethodGet && path == "/dashboard":
		projectID, _ := strconv.ParseInt(r.URL.Query().Get("projectId"), 10, 64)
		a.dashboardResponse(w, projectID, user)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/reports/project/"):
		a.handleReportRoutes(w, r, path, user)
	default:
		writeError(w, http.StatusNotFound, "Маршрут не найден")
	}
}

func (a *app) handleProjectRoutes(w http.ResponseWriter, r *http.Request, path string, user User) {
	parts := splitPath(path)
	if len(parts) < 2 {
		writeError(w, http.StatusNotFound, "Проект не найден")
		return
	}
	projectID, _ := strconv.ParseInt(parts[1], 10, 64)
	if !a.canAccessProject(projectID, user) {
		writeError(w, http.StatusForbidden, "Нет доступа к проекту")
		return
	}

	switch {
	case len(parts) == 3 && parts[2] == "members" && r.Method == http.MethodGet:
		rows, err := a.listMembers(projectID)
		writeResult(w, rows, err)
	case len(parts) == 3 && parts[2] == "members" && r.Method == http.MethodPost:
		a.addMember(w, r, projectID, user)
	case len(parts) == 3 && parts[2] == "pipeline-stages" && r.Method == http.MethodGet:
		rows, err := a.listStages(projectID)
		writeResult(w, rows, err)
	case len(parts) == 3 && parts[2] == "pipeline-stages" && r.Method == http.MethodPost:
		a.addStage(w, r, projectID, user)
	case len(parts) == 4 && parts[2] == "pipeline-stages" && r.Method == http.MethodDelete:
		stageID, _ := strconv.ParseInt(parts[3], 10, 64)
		a.deleteStage(w, projectID, stageID, user)
	case len(parts) == 3 && parts[2] == "clients" && r.Method == http.MethodGet:
		rows, err := a.listClients(projectID, user)
		writeResult(w, rows, err)
	case len(parts) == 3 && parts[2] == "clients" && r.Method == http.MethodPost:
		a.createClient(w, r, projectID, user)
	default:
		writeError(w, http.StatusNotFound, "Маршрут проекта не найден")
	}
}

func (a *app) handleClientRoutes(w http.ResponseWriter, r *http.Request, path string, user User) {
	parts := splitPath(path)
	if len(parts) < 2 {
		writeError(w, http.StatusNotFound, "Клиент не найден")
		return
	}
	clientID, _ := strconv.ParseInt(parts[1], 10, 64)
	client, err := a.getClient(clientID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Клиент не найден")
		return
	}
	if !a.canAccessProject(asInt64(client["project_id"]), user) {
		writeError(w, http.StatusForbidden, "Нет доступа к клиенту")
		return
	}
	if user.Role == "sales_manager" && asInt64(client["assigned_manager_id"]) != user.ID {
		writeError(w, http.StatusForbidden, "Менеджер видит только назначенных клиентов")
		return
	}

	switch {
	case len(parts) == 2 && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, client)
	case len(parts) == 2 && r.Method == http.MethodDelete:
		a.deleteClient(w, client, user)
	case len(parts) == 2 && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		a.updateClient(w, r, client, user)
	case len(parts) == 3 && parts[2] == "assign" && r.Method == http.MethodPost:
		a.assignClient(w, r, client, user)
	case len(parts) == 3 && parts[2] == "contacts" && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		a.updateClientContacts(w, r, client, user)
	case len(parts) == 3 && parts[2] == "move-stage" && r.Method == http.MethodPost:
		a.moveClientStage(w, r, client, user)
	case len(parts) == 3 && parts[2] == "notes" && r.Method == http.MethodGet:
		rows, err := a.queryMaps(`
			SELECT client_notes.*, crm_users.first_name || ' ' || crm_users.last_name AS manager_name
			FROM client_notes
			JOIN crm_users ON crm_users.id = client_notes.manager_id
			WHERE client_notes.client_id = ?
			ORDER BY client_notes.created_at ASC
		`, clientID)
		writeResult(w, rows, err)
	case len(parts) == 3 && parts[2] == "notes" && r.Method == http.MethodPost:
		a.addNote(w, r, clientID, user)
	case len(parts) == 4 && parts[2] == "notes" && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		noteID, _ := strconv.ParseInt(parts[3], 10, 64)
		a.updateNote(w, r, clientID, noteID, user)
	case len(parts) == 4 && parts[2] == "notes" && r.Method == http.MethodDelete:
		noteID, _ := strconv.ParseInt(parts[3], 10, 64)
		a.deleteNote(w, clientID, noteID, user)
	case len(parts) == 3 && parts[2] == "interactions" && r.Method == http.MethodGet:
		rows, err := a.queryMaps(`
			SELECT client_interactions.*, crm_users.first_name || ' ' || crm_users.last_name AS manager_name
			FROM client_interactions
			JOIN crm_users ON crm_users.id = client_interactions.manager_id
			WHERE client_interactions.client_id = ?
			ORDER BY client_interactions.scheduled_at ASC
		`, clientID)
		writeResult(w, rows, err)
	case len(parts) == 3 && parts[2] == "interactions" && r.Method == http.MethodPost:
		a.addInteraction(w, r, client, user)
	default:
		writeError(w, http.StatusNotFound, "Маршрут клиента не найден")
	}
}

func (a *app) handleReportRoutes(w http.ResponseWriter, r *http.Request, path string, user User) {
	parts := splitPath(path)
	if len(parts) < 3 {
		writeError(w, http.StatusNotFound, "Отчет не найден")
		return
	}
	projectID, _ := strconv.ParseInt(parts[2], 10, 64)
	if !a.canAccessProject(projectID, user) {
		writeError(w, http.StatusForbidden, "Нет доступа к проекту")
		return
	}
	if len(parts) == 4 && parts[3] == "download" {
		a.downloadReport(w, projectID, user)
		return
	}
	a.dashboardResponse(w, projectID, user)
}

func (a *app) register(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	firstName := str(req["first_name"])
	lastName := str(req["last_name"])
	email := str(req["email"])
	password := str(req["password"])
	role := str(req["role"])
	companyName := str(req["company_name"])
	if firstName == "" || lastName == "" || email == "" || password == "" || role == "" {
		writeError(w, http.StatusBadRequest, "Заполните обязательные поля")
		return
	}
	if role != "sales_manager" && role != "manager_owner" {
		writeError(w, http.StatusBadRequest, "Некорректная роль")
		return
	}
	if role == "manager_owner" && companyName == "" {
		writeError(w, http.StatusBadRequest, "Для управляющего нужна компания")
		return
	}
	if _, err := a.userByEmail(email); err == nil {
		writeError(w, http.StatusConflict, "Email уже зарегистрирован")
		return
	}

	hash, err := hashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось создать пароль")
		return
	}
	res, err := a.db.Exec(`
		INSERT INTO crm_users (first_name, last_name, email, password_hash, role)
		VALUES (?, ?, ?, ?, ?)
	`, firstName, lastName, email, hash, role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	userID, _ := res.LastInsertId()
	user, _ := a.userByID(userID)

	if role == "manager_owner" {
		if err := a.createDefaultCompanyProject(userID, companyName); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	token := a.createSession(user.ID)
	projects, _ := a.listProjects(user)
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user, "projects": projects})
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var req map[string]string
	if !readBody(w, r, &req) {
		return
	}
	row, err := a.userRowByEmail(req["email"])
	if err != nil || !verifyPassword(req["password"], str(row["password_hash"])) {
		writeError(w, http.StatusUnauthorized, "Неверный email или пароль")
		return
	}
	user := publicUser(row)
	token := a.createSession(user.ID)
	projects, _ := a.listProjects(user)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user, "projects": projects})
}

func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	a.mu.Lock()
	delete(a.sessions, token)
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *app) createProject(w http.ResponseWriter, r *http.Request, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Доступно только управляющему")
		return
	}
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	name := str(req["name"])
	if name == "" {
		writeError(w, http.StatusBadRequest, "Название проекта обязательно")
		return
	}
	companyID := asInt64(req["company_id"])
	if companyID == 0 {
		_ = a.db.QueryRow("SELECT id FROM companies WHERE owner_id = ? ORDER BY id LIMIT 1", user.ID).Scan(&companyID)
	}
	res, err := a.db.Exec("INSERT INTO projects (company_id, name, description) VALUES (?, ?, ?)", companyID, name, nullString(str(req["description"])))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	projectID, _ := res.LastInsertId()
	_, _ = a.db.Exec("INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'owner')", projectID, user.ID)
	if err := a.createDefaultStages(projectID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	project, err := a.getProject(projectID)
	writeResult(w, project, err)
}

func (a *app) addMember(w http.ResponseWriter, r *http.Request, projectID int64, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Доступно только управляющему")
		return
	}
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	email := str(req["email"])
	if email == "" {
		writeError(w, http.StatusBadRequest, "Email менеджера обязателен")
		return
	}
	manager, err := a.userByEmail(email)
	if err != nil {
		firstName := str(req["first_name"])
		lastName := str(req["last_name"])
		if firstName == "" {
			firstName = "Новый"
		}
		if lastName == "" {
			lastName = "Менеджер"
		}
		hash, _ := hashPassword("demo123")
		res, err := a.db.Exec(`
			INSERT INTO crm_users (first_name, last_name, email, password_hash, role)
			VALUES (?, ?, ?, ?, 'sales_manager')
		`, firstName, lastName, email, hash)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		id, _ := res.LastInsertId()
		manager, _ = a.userByID(id)
	}
	_, err = a.db.Exec("INSERT OR IGNORE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'manager')", projectID, manager.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	members, _ := a.listMembers(projectID)
	writeJSON(w, http.StatusCreated, map[string]any{"member": manager, "members": members})
}

func (a *app) addStage(w http.ResponseWriter, r *http.Request, projectID int64, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Доступно только управляющему")
		return
	}
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	name := str(req["name"])
	if name == "" {
		writeError(w, http.StatusBadRequest, "Название этапа обязательно")
		return
	}
	position := asInt64(req["position"])
	if position == 0 {
		_ = a.db.QueryRow("SELECT COUNT(*) + 1 FROM funnel_stages WHERE project_id = ?", projectID).Scan(&position)
	}
	color := str(req["color"])
	if color == "" {
		color = "#2e8b7d"
	}
	maxDays := asInt64(req["max_days_without_activity"])
	if maxDays == 0 {
		maxDays = 7
	}
	res, err := a.db.Exec(`
		INSERT INTO funnel_stages (project_id, name, position, color, max_days_without_activity)
		VALUES (?, ?, ?, ?, ?)
	`, projectID, name, position, color, maxDays)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	row, err := a.queryOne("SELECT * FROM funnel_stages WHERE id = ?", id)
	writeResultStatus(w, row, err, http.StatusCreated)
}

func (a *app) deleteStage(w http.ResponseWriter, projectID, stageID int64, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Доступно только управляющему")
		return
	}
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM funnel_stages WHERE id = ? AND project_id = ?", stageID, projectID).Scan(&count); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if count == 0 {
		writeError(w, http.StatusNotFound, "Этап не найден")
		return
	}
	if err := a.db.QueryRow("SELECT COUNT(*) FROM crm_clients WHERE current_stage_id = ?", stageID).Scan(&count); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if count > 0 {
		writeError(w, http.StatusConflict, "Нельзя удалить этап, пока на нем есть клиенты")
		return
	}
	if err := a.db.QueryRow("SELECT COUNT(*) FROM stage_transitions WHERE from_stage_id = ? OR to_stage_id = ?", stageID, stageID).Scan(&count); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if count > 0 {
		writeError(w, http.StatusConflict, "Нельзя удалить этап, который уже есть в истории переходов")
		return
	}
	if _, err := a.db.Exec("DELETE FROM funnel_stages WHERE id = ? AND project_id = ?", stageID, projectID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = a.db.Exec(`
		UPDATE funnel_stages
		SET position = (
			SELECT COUNT(*) FROM funnel_stages AS previous
			WHERE previous.project_id = funnel_stages.project_id
				AND previous.position <= funnel_stages.position
		)
		WHERE project_id = ?
	`, projectID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *app) createClient(w http.ResponseWriter, r *http.Request, projectID int64, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Клиентов создает управляющий")
		return
	}
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	name := str(req["name"])
	if name == "" {
		writeError(w, http.StatusBadRequest, "Имя клиента обязательно")
		return
	}
	stageID := asInt64(req["current_stage_id"])
	if stageID == 0 {
		stages, _ := a.listStages(projectID)
		if len(stages) > 0 {
			stageID = asInt64(stages[0]["id"])
		}
	}
	if stageID == 0 {
		writeError(w, http.StatusBadRequest, "Сначала создайте этапы воронки")
		return
	}
	contacts, _ := json.Marshal(req["contacts"])
	tags := normalizeTags(req["tags"])
	tagJSON, _ := json.Marshal(tags)
	managerID := nullInt(asInt64(req["assigned_manager_id"]))
	res, err := a.db.Exec(`
		INSERT INTO crm_clients
			(project_id, assigned_manager_id, current_stage_id, name, short_description, contacts, tags, deal_amount)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, projectID, managerID, stageID, name, nullString(str(req["short_description"])), string(contacts), string(tagJSON), asFloat(req["deal_amount"]))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	clientID, _ := res.LastInsertId()
	client, _ := a.getClient(clientID)
	if managerID.Valid {
		_, _ = a.db.Exec(`
			INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
			VALUES (?, 'new_lead_assigned', 'Новый клиент назначен', ?, 'client', ?)
		`, managerID.Int64, fmt.Sprintf("%s назначен вам.", str(client["name"])), clientID)
	}
	writeJSON(w, http.StatusCreated, client)
}

func (a *app) assignClient(w http.ResponseWriter, r *http.Request, client map[string]any, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Доступно только управляющему")
		return
	}
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	managerID := asInt64(req["manager_id"])
	if managerID == 0 || !a.isProjectMember(asInt64(client["project_id"]), managerID) {
		writeError(w, http.StatusBadRequest, "Менеджер не найден в проекте")
		return
	}
	clientID := asInt64(client["id"])
	_, err := a.db.Exec("UPDATE crm_clients SET assigned_manager_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", managerID, clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = a.db.Exec(`
		INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
		VALUES (?, 'new_lead_assigned', 'Клиент назначен', ?, 'client', ?)
	`, managerID, fmt.Sprintf("%s назначен вам.", str(client["name"])), clientID)
	next, err := a.getClient(clientID)
	writeResult(w, next, err)
}

func (a *app) updateClientContacts(w http.ResponseWriter, r *http.Request, client map[string]any, user User) {
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	contacts, _ := json.Marshal(req["contacts"])
	clientID := asInt64(client["id"])
	_, err := a.db.Exec("UPDATE crm_clients SET contacts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", string(contacts), clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	next, err := a.getClient(clientID)
	writeResult(w, next, err)
}

func (a *app) updateClient(w http.ResponseWriter, r *http.Request, client map[string]any, user User) {
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	name := strings.TrimSpace(str(req["name"]))
	if name == "" {
		writeError(w, http.StatusBadRequest, "Имя клиента обязательно")
		return
	}
	clientID := asInt64(client["id"])
	_, err := a.db.Exec(`
		UPDATE crm_clients
		SET name = ?, short_description = COALESCE(?, short_description), updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, name, nullString(str(req["short_description"])), clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	next, err := a.getClient(clientID)
	writeResult(w, next, err)
}

func (a *app) deleteClient(w http.ResponseWriter, client map[string]any, user User) {
	if user.Role != "manager_owner" {
		writeError(w, http.StatusForbidden, "Удалять клиентов может только управляющий")
		return
	}
	clientID := asInt64(client["id"])
	tx, err := a.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM notifications WHERE related_entity_type = 'client' AND related_entity_id = ?", clientID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err = tx.Exec("DELETE FROM client_interactions WHERE client_id = ?", clientID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err = tx.Exec("DELETE FROM client_notes WHERE client_id = ?", clientID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err = tx.Exec("DELETE FROM stage_transitions WHERE client_id = ?", clientID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err = tx.Exec("DELETE FROM crm_clients WHERE id = ?", clientID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *app) moveClientStage(w http.ResponseWriter, r *http.Request, client map[string]any, user User) {
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	stageID := asInt64(req["to_stage_id"])
	projectID := asInt64(client["project_id"])
	var exists int
	_ = a.db.QueryRow("SELECT COUNT(*) FROM funnel_stages WHERE id = ? AND project_id = ?", stageID, projectID).Scan(&exists)
	if exists == 0 {
		writeError(w, http.StatusBadRequest, "Этап не найден")
		return
	}
	clientID := asInt64(client["id"])
	_, err := a.db.Exec(`
		INSERT INTO stage_transitions (client_id, project_id, manager_id, from_stage_id, to_stage_id, comment)
		VALUES (?, ?, ?, ?, ?, ?)
	`, clientID, projectID, user.ID, nullInt(asInt64(client["current_stage_id"])), stageID, nullString(str(req["comment"])))
	if err == nil {
		_, err = a.db.Exec("UPDATE crm_clients SET current_stage_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", stageID, clientID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	next, err := a.getClient(clientID)
	writeResult(w, next, err)
}

func (a *app) addNote(w http.ResponseWriter, r *http.Request, clientID int64, user User) {
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	message := str(req["message"])
	if message == "" {
		writeError(w, http.StatusBadRequest, "Текст заметки обязателен")
		return
	}
	source := str(req["source"])
	if source == "" {
		source = "manual"
	}
	res, err := a.db.Exec("INSERT INTO client_notes (client_id, manager_id, message, source) VALUES (?, ?, ?, ?)", clientID, user.ID, message, source)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = a.db.Exec("UPDATE crm_clients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", clientID)
	id, _ := res.LastInsertId()
	row, err := a.queryOne("SELECT * FROM client_notes WHERE id = ?", id)
	writeResultStatus(w, row, err, http.StatusCreated)
}

func (a *app) updateNoteByPath(w http.ResponseWriter, r *http.Request, path string, user User) {
	parts := splitPath(path)
	if len(parts) != 2 {
		writeError(w, http.StatusNotFound, "Заметка не найдена")
		return
	}
	noteID, _ := strconv.ParseInt(parts[1], 10, 64)
	note, err := a.getNoteForMutation(noteID, user)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	a.updateNote(w, r, asInt64(note["client_id"]), noteID, user)
}

func (a *app) deleteNoteByPath(w http.ResponseWriter, path string, user User) {
	parts := splitPath(path)
	if len(parts) != 2 {
		writeError(w, http.StatusNotFound, "Заметка не найдена")
		return
	}
	noteID, _ := strconv.ParseInt(parts[1], 10, 64)
	note, err := a.getNoteForMutation(noteID, user)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	a.deleteNote(w, asInt64(note["client_id"]), noteID, user)
}

func (a *app) getNoteForMutation(noteID int64, user User) (map[string]any, error) {
	note, err := a.queryOne(`
		SELECT client_notes.*, crm_clients.project_id, crm_clients.assigned_manager_id
		FROM client_notes
		JOIN crm_clients ON crm_clients.id = client_notes.client_id
		WHERE client_notes.id = ?
	`, noteID)
	if err != nil {
		return nil, errors.New("Заметка не найдена")
	}
	if !a.canAccessProject(asInt64(note["project_id"]), user) {
		return nil, errors.New("Нет доступа")
	}
	if user.Role == "sales_manager" && asInt64(note["assigned_manager_id"]) != user.ID {
		return nil, errors.New("Нет доступа")
	}
	if asInt64(note["manager_id"]) != user.ID {
		return nil, errors.New("Изменять заметку может только автор")
	}
	return note, nil
}

func (a *app) updateNote(w http.ResponseWriter, r *http.Request, clientID, noteID int64, user User) {
	note, err := a.queryOne("SELECT * FROM client_notes WHERE id = ? AND client_id = ?", noteID, clientID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Заметка не найдена")
		return
	}
	if asInt64(note["manager_id"]) != user.ID {
		writeError(w, http.StatusForbidden, "Редактировать заметку может только автор")
		return
	}
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	message := strings.TrimSpace(str(req["message"]))
	if message == "" {
		writeError(w, http.StatusBadRequest, "Текст заметки обязателен")
		return
	}
	_, err = a.db.Exec("UPDATE client_notes SET message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", message, noteID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	row, err := a.queryOne("SELECT * FROM client_notes WHERE id = ?", noteID)
	writeResult(w, row, err)
}

func (a *app) deleteNote(w http.ResponseWriter, clientID, noteID int64, user User) {
	note, err := a.queryOne("SELECT * FROM client_notes WHERE id = ? AND client_id = ?", noteID, clientID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Заметка не найдена")
		return
	}
	if asInt64(note["manager_id"]) != user.ID {
		writeError(w, http.StatusForbidden, "Удалить заметку может только автор")
		return
	}
	_, err = a.db.Exec("DELETE FROM client_notes WHERE id = ?", noteID)
	writeResult(w, map[string]bool{"ok": true}, err)
}

func (a *app) addInteraction(w http.ResponseWriter, r *http.Request, client map[string]any, user User) {
	var req map[string]any
	if !readBody(w, r, &req) {
		return
	}
	title := str(req["title"])
	scheduledAt := str(req["scheduled_at"])
	if title == "" || scheduledAt == "" {
		writeError(w, http.StatusBadRequest, "Название и дата события обязательны")
		return
	}
	kind := str(req["type"])
	if kind == "" {
		kind = "call"
	}
	managerID := asInt64(client["assigned_manager_id"])
	if managerID == 0 {
		managerID = user.ID
	}
	res, err := a.db.Exec(`
		INSERT INTO client_interactions (client_id, manager_id, project_id, type, title, description, scheduled_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, asInt64(client["id"]), managerID, asInt64(client["project_id"]), kind, title, nullString(str(req["description"])), scheduledAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	row, err := a.queryOne("SELECT * FROM client_interactions WHERE id = ?", id)
	writeResultStatus(w, row, err, http.StatusCreated)
}

func (a *app) completeInteraction(w http.ResponseWriter, path string, user User) {
	parts := splitPath(path)
	if len(parts) < 2 {
		writeError(w, http.StatusNotFound, "Событие не найдено")
		return
	}
	id, _ := strconv.ParseInt(parts[1], 10, 64)
	row, err := a.queryOne("SELECT * FROM client_interactions WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusNotFound, "Событие не найдено")
		return
	}
	if !a.canAccessProject(asInt64(row["project_id"]), user) {
		writeError(w, http.StatusForbidden, "Нет доступа")
		return
	}
	_, err = a.db.Exec(`
		UPDATE client_interactions
		SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	next, err := a.queryOne("SELECT * FROM client_interactions WHERE id = ?", id)
	writeResult(w, next, err)
}

func (a *app) deleteInteraction(w http.ResponseWriter, path string, user User) {
	parts := splitPath(path)
	if len(parts) < 2 {
		writeError(w, http.StatusNotFound, "Событие не найдено")
		return
	}
	id, _ := strconv.ParseInt(parts[1], 10, 64)
	row, err := a.queryOne("SELECT * FROM client_interactions WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusNotFound, "Событие не найдено")
		return
	}
	if !a.canAccessProject(asInt64(row["project_id"]), user) {
		writeError(w, http.StatusForbidden, "Нет доступа")
		return
	}
	if user.Role == "sales_manager" && asInt64(row["manager_id"]) != user.ID {
		writeError(w, http.StatusForbidden, "Удалить событие может только назначенный менеджер")
		return
	}
	_, err = a.db.Exec("DELETE FROM client_interactions WHERE id = ?", id)
	writeResult(w, map[string]bool{"ok": true}, err)
}

func (a *app) startEmailReminderWorker() {
	if !a.mail.enabled() {
		log.Print("SMTP is not configured; email reminders are disabled")
		return
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	a.sendDueEmailReminders()
	for range ticker.C {
		a.sendDueEmailReminders()
	}
}

func (a *app) sendDueEmailReminders() {
	rows, err := a.queryMaps(`
		SELECT client_interactions.*, crm_clients.name AS client_name,
			crm_users.email AS manager_email,
			crm_users.first_name || ' ' || crm_users.last_name AS manager_name
		FROM client_interactions
		JOIN crm_clients ON crm_clients.id = client_interactions.client_id
		JOIN crm_users ON crm_users.id = client_interactions.manager_id
		WHERE client_interactions.status = 'planned'
			AND client_interactions.email_reminder_sent_at IS NULL
		ORDER BY client_interactions.scheduled_at ASC
		LIMIT 1000
	`)
	if err != nil {
		log.Printf("email reminder query failed: %v", err)
		return
	}
	now := time.Now()
	for _, row := range rows {
		scheduledAt, err := parseInteractionTime(str(row["scheduled_at"]))
		if err != nil {
			continue
		}
		until := scheduledAt.Sub(now)
		if until < 0 || until > time.Minute {
			continue
		}
		if err := a.sendInteractionReminder(row, scheduledAt); err != nil {
			log.Printf("email reminder failed for interaction %v: %v", row["id"], err)
			continue
		}
		_, err = a.db.Exec(
			"UPDATE client_interactions SET email_reminder_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			asInt64(row["id"]),
		)
		if err != nil {
			log.Printf("email reminder mark failed for interaction %v: %v", row["id"], err)
		}
	}
}

func (a *app) sendInteractionReminder(row map[string]any, scheduledAt time.Time) error {
	to := str(row["manager_email"])
	if to == "" {
		return errors.New("manager email is empty")
	}
	subject := fmt.Sprintf("Напоминание: %s через минуту", str(row["title"]))
	body := fmt.Sprintf(
		"Здравствуйте, %s!\n\nЧерез минуту запланировано событие по клиенту %s.\n\nСобытие: %s\nТип: %s\nВремя: %s\n\n%s\n",
		str(row["manager_name"]),
		str(row["client_name"]),
		str(row["title"]),
		interactionTypeText(str(row["type"])),
		scheduledAt.Format("02.01.2006 15:04"),
		str(row["description"]),
	)
	return a.sendEmail(to, subject, body)
}

func (a *app) sendEmail(to, subject, body string) error {
	addr := a.mail.Host + ":" + a.mail.Port
	auth := smtp.PlainAuth("", a.mail.User, a.mail.Pass, a.mail.Host)
	fromAddress, err := envelopeEmailAddress(a.mail.From)
	if err != nil {
		return err
	}
	message := strings.Join([]string{
		"From: " + a.mail.From,
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("utf-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")
	if a.mail.Port == "465" {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: a.mail.Host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		defer conn.Close()

		client, err := smtp.NewClient(conn, a.mail.Host)
		if err != nil {
			return err
		}
		defer client.Close()
		if err := client.Auth(auth); err != nil {
			return err
		}
		if err := client.Mail(fromAddress); err != nil {
			return err
		}
		if err := client.Rcpt(to); err != nil {
			return err
		}
		writer, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := writer.Write([]byte(message)); err != nil {
			_ = writer.Close()
			return err
		}
		if err := writer.Close(); err != nil {
			return err
		}
		return client.Quit()
	}
	return smtp.SendMail(addr, auth, fromAddress, []string{to}, []byte(message))
}

func envelopeEmailAddress(value string) (string, error) {
	address, err := mail.ParseAddress(value)
	if err != nil {
		return "", err
	}
	return address.Address, nil
}

func parseInteractionTime(value string) (time.Time, error) {
	layouts := []string{
		"2006-01-02T15:04",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		time.RFC3339,
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported time format: %s", value)
}

func interactionTypeText(kind string) string {
	switch kind {
	case "call":
		return "звонок"
	case "meeting":
		return "встреча"
	case "message":
		return "сообщение"
	case "email":
		return "email"
	default:
		return "событие"
	}
}

func (a *app) dashboardResponse(w http.ResponseWriter, projectID int64, user User) {
	if projectID == 0 || !a.canAccessProject(projectID, user) {
		writeError(w, http.StatusForbidden, "Нет доступа к проекту")
		return
	}
	data, err := a.dashboard(projectID, user)
	writeResult(w, data, err)
}

func (a *app) dashboard(projectID int64, user User) (map[string]any, error) {
	clients, err := a.listClients(projectID, user)
	if err != nil {
		return nil, err
	}
	stages, err := a.listStages(projectID)
	if err != nil {
		return nil, err
	}
	var activeAmount float64
	successStages := map[int64]bool{}
	for _, stage := range stages {
		if asInt64(stage["is_final_success"]) == 1 {
			successStages[asInt64(stage["id"])] = true
		}
	}
	var wonClients int64
	var wonAmount float64
	for _, client := range clients {
		activeAmount += asFloat(client["deal_amount"])
		if successStages[asInt64(client["current_stage_id"])] {
			wonClients++
			wonAmount += asFloat(client["deal_amount"])
		}
	}
	for _, stage := range stages {
		var count int64
		var amount float64
		for _, client := range clients {
			if asInt64(client["current_stage_id"]) == asInt64(stage["id"]) {
				count++
				amount += asFloat(client["deal_amount"])
			}
		}
		stage["clients_count"] = count
		stage["amount"] = amount
	}

	plannedQuery := "SELECT COUNT(*) FROM client_interactions WHERE project_id = ? AND status = 'planned'"
	args := []any{projectID}
	if user.Role == "sales_manager" {
		plannedQuery += " AND manager_id = ?"
		args = append(args, user.ID)
	}
	var planned int64
	_ = a.db.QueryRow(plannedQuery, args...).Scan(&planned)
	var unread int64
	_ = a.db.QueryRow("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0", user.ID).Scan(&unread)
	transitionQuery := "SELECT COUNT(*) FROM stage_transitions WHERE project_id = ?"
	transitionArgs := []any{projectID}
	if user.Role == "sales_manager" {
		transitionQuery += " AND manager_id = ?"
		transitionArgs = append(transitionArgs, user.ID)
	}
	var transitionsCount int64
	_ = a.db.QueryRow(transitionQuery, transitionArgs...).Scan(&transitionsCount)
	completedQuery := "SELECT COUNT(*) FROM client_interactions WHERE project_id = ? AND status = 'completed'"
	completedArgs := []any{projectID}
	if user.Role == "sales_manager" {
		completedQuery += " AND manager_id = ?"
		completedArgs = append(completedArgs, user.ID)
	}
	var completedInteractions int64
	_ = a.db.QueryRow(completedQuery, completedArgs...).Scan(&completedInteractions)
	overdueQuery := "SELECT COUNT(*) FROM client_interactions WHERE project_id = ? AND status IN ('missed', 'planned') AND scheduled_at < datetime('now')"
	overdueArgs := []any{projectID}
	if user.Role == "sales_manager" {
		overdueQuery += " AND manager_id = ?"
		overdueArgs = append(overdueArgs, user.ID)
	}
	var overdueInteractions int64
	_ = a.db.QueryRow(overdueQuery, overdueArgs...).Scan(&overdueInteractions)
	notesQuery := `
		SELECT COUNT(*)
		FROM client_notes
		JOIN crm_clients ON crm_clients.id = client_notes.client_id
		WHERE crm_clients.project_id = ?
	`
	notesArgs := []any{projectID}
	if user.Role == "sales_manager" {
		notesQuery += " AND client_notes.manager_id = ?"
		notesArgs = append(notesArgs, user.ID)
	}
	var notesCount int64
	_ = a.db.QueryRow(notesQuery, notesArgs...).Scan(&notesCount)
	var avgDeal float64
	if len(clients) > 0 {
		avgDeal = activeAmount / float64(len(clients))
	}

	managers, err := a.managerMetrics(projectID, user)
	if err != nil {
		return nil, err
	}
	upcomingQuery := `
		SELECT client_interactions.*, crm_clients.name AS client_name
		FROM client_interactions
		JOIN crm_clients ON crm_clients.id = client_interactions.client_id
		WHERE client_interactions.project_id = ? AND client_interactions.status = 'planned'
	`
	upcomingArgs := []any{projectID}
	if user.Role == "sales_manager" {
		upcomingQuery += " AND client_interactions.manager_id = ?"
		upcomingArgs = append(upcomingArgs, user.ID)
	}
	upcomingQuery += " ORDER BY client_interactions.scheduled_at ASC LIMIT 100"
	upcoming, err := a.queryMaps(upcomingQuery, upcomingArgs...)
	if err != nil {
		return nil, err
	}
	transitionsQuery := `
		SELECT stage_transitions.*, crm_clients.name AS client_name,
			from_stage.name AS from_stage_name, to_stage.name AS to_stage_name,
			crm_users.first_name || ' ' || crm_users.last_name AS manager_name
		FROM stage_transitions
		JOIN crm_clients ON crm_clients.id = stage_transitions.client_id
		LEFT JOIN funnel_stages AS from_stage ON from_stage.id = stage_transitions.from_stage_id
		JOIN funnel_stages AS to_stage ON to_stage.id = stage_transitions.to_stage_id
		LEFT JOIN crm_users ON crm_users.id = stage_transitions.manager_id
		WHERE stage_transitions.project_id = ?
	`
	transitionsArgs := []any{projectID}
	if user.Role == "sales_manager" {
		transitionsQuery += " AND stage_transitions.manager_id = ?"
		transitionsArgs = append(transitionsArgs, user.ID)
	}
	transitionsQuery += `
		ORDER BY stage_transitions.created_at DESC
		LIMIT 8
	`
	transitions, err := a.queryMaps(transitionsQuery, transitionsArgs...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"stats": map[string]any{
			"clients":               len(clients),
			"activeAmount":          activeAmount,
			"plannedInteractions":   planned,
			"unreadNotifications":   unread,
			"transitions":           transitionsCount,
			"completedInteractions": completedInteractions,
			"overdueInteractions":   overdueInteractions,
			"notes":                 notesCount,
			"wonClients":            wonClients,
			"wonAmount":             wonAmount,
			"avgDeal":               avgDeal,
		},
		"stages":      stages,
		"managers":    managers,
		"upcoming":    upcoming,
		"transitions": transitions,
	}, nil
}

func (a *app) managerMetrics(projectID int64, user User) ([]map[string]any, error) {
	query := `
		SELECT crm_users.id, crm_users.first_name || ' ' || crm_users.last_name AS name,
			(
				SELECT COUNT(*) FROM crm_clients
				WHERE crm_clients.project_id = project_members.project_id
					AND crm_clients.assigned_manager_id = crm_users.id
			) AS clients_count,
			(
				SELECT COALESCE(SUM(deal_amount), 0) FROM crm_clients
				WHERE crm_clients.project_id = project_members.project_id
					AND crm_clients.assigned_manager_id = crm_users.id
			) AS pipeline_amount,
			(
				SELECT COUNT(*) FROM stage_transitions
				WHERE stage_transitions.project_id = project_members.project_id
					AND stage_transitions.manager_id = crm_users.id
			) AS transitions_count,
			(
				SELECT COUNT(*) FROM client_interactions
				WHERE client_interactions.project_id = project_members.project_id
					AND client_interactions.manager_id = crm_users.id
					AND client_interactions.status = 'completed'
			) AS completed_interactions,
			(
				SELECT COUNT(*) FROM client_interactions
				WHERE client_interactions.project_id = project_members.project_id
					AND client_interactions.manager_id = crm_users.id
					AND client_interactions.status IN ('missed', 'planned')
					AND client_interactions.scheduled_at < datetime('now')
			) AS overdue_interactions
		FROM project_members
		JOIN crm_users ON crm_users.id = project_members.user_id
		WHERE project_members.project_id = ? AND crm_users.role = 'sales_manager'
	`
	args := []any{projectID}
	if user.Role == "sales_manager" {
		query += " AND crm_users.id = ?"
		args = append(args, user.ID)
	}
	query += `
		ORDER BY transitions_count DESC, pipeline_amount DESC
	`
	return a.queryMaps(query, args...)
}

func (a *app) downloadReport(w http.ResponseWriter, projectID int64, user User) {
	data, err := a.dashboard(projectID, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="project-%d-report.csv"`, projectID))
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"manager", "clients", "pipeline_amount", "transitions", "completed_interactions", "overdue_interactions"})
	for _, manager := range data["managers"].([]map[string]any) {
		_ = cw.Write([]string{
			str(manager["name"]),
			fmt.Sprint(manager["clients_count"]),
			fmt.Sprint(manager["pipeline_amount"]),
			fmt.Sprint(manager["transitions_count"]),
			fmt.Sprint(manager["completed_interactions"]),
			fmt.Sprint(manager["overdue_interactions"]),
		})
	}
	cw.Flush()
}

func (a *app) listProjects(user User) ([]map[string]any, error) {
	if user.Role == "manager_owner" {
		return a.queryMaps(`
			SELECT projects.*, companies.name AS company_name
			FROM projects
			JOIN companies ON companies.id = projects.company_id
			WHERE companies.owner_id = ?
			ORDER BY projects.created_at DESC
		`, user.ID)
	}
	return a.queryMaps(`
		SELECT projects.*, companies.name AS company_name
		FROM projects
		JOIN companies ON companies.id = projects.company_id
		JOIN project_members ON project_members.project_id = projects.id
		WHERE project_members.user_id = ?
		ORDER BY projects.created_at DESC
	`, user.ID)
}

func (a *app) listMembers(projectID int64) ([]User, error) {
	rows, err := a.queryMaps(`
		SELECT crm_users.id, crm_users.first_name, crm_users.last_name, crm_users.email, crm_users.role,
			project_members.role_in_project, project_members.created_at
		FROM project_members
		JOIN crm_users ON crm_users.id = project_members.user_id
		WHERE project_members.project_id = ?
		ORDER BY crm_users.role, crm_users.last_name
	`, projectID)
	if err != nil {
		return nil, err
	}
	users := make([]User, 0, len(rows))
	for _, row := range rows {
		users = append(users, publicUser(row))
	}
	return users, nil
}

func (a *app) listStages(projectID int64) ([]map[string]any, error) {
	rows, err := a.queryMaps("SELECT * FROM funnel_stages WHERE project_id = ? ORDER BY position", projectID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		if err := a.createDefaultStages(projectID); err != nil {
			return nil, err
		}
		return a.queryMaps("SELECT * FROM funnel_stages WHERE project_id = ? ORDER BY position", projectID)
	}
	return rows, nil
}

func (a *app) listClients(projectID int64, user User) ([]map[string]any, error) {
	query := `
		SELECT crm_clients.*,
			funnel_stages.name AS stage_name,
			funnel_stages.color AS stage_color,
			funnel_stages.max_days_without_activity,
			crm_users.first_name || ' ' || crm_users.last_name AS manager_name,
			MAX(client_notes.created_at) AS last_note_at,
			MAX(client_interactions.created_at) AS last_interaction_at
		FROM crm_clients
		LEFT JOIN funnel_stages ON funnel_stages.id = crm_clients.current_stage_id
		LEFT JOIN crm_users ON crm_users.id = crm_clients.assigned_manager_id
		LEFT JOIN client_notes ON client_notes.client_id = crm_clients.id
		LEFT JOIN client_interactions ON client_interactions.client_id = crm_clients.id
		WHERE crm_clients.project_id = ?
	`
	args := []any{projectID}
	if user.Role == "sales_manager" {
		query += " AND crm_clients.assigned_manager_id = ?"
		args = append(args, user.ID)
	}
	query += " GROUP BY crm_clients.id ORDER BY crm_clients.updated_at DESC"
	rows, err := a.queryMaps(query, args...)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		normalizeClient(row)
	}
	return rows, nil
}

func (a *app) getClient(clientID int64) (map[string]any, error) {
	row, err := a.queryOne(`
		SELECT crm_clients.*,
			funnel_stages.name AS stage_name,
			crm_users.first_name || ' ' || crm_users.last_name AS manager_name
		FROM crm_clients
		LEFT JOIN funnel_stages ON funnel_stages.id = crm_clients.current_stage_id
		LEFT JOIN crm_users ON crm_users.id = crm_clients.assigned_manager_id
		WHERE crm_clients.id = ?
	`, clientID)
	if err != nil {
		return nil, err
	}
	normalizeClient(row)
	return row, nil
}

func (a *app) getProject(projectID int64) (map[string]any, error) {
	return a.queryOne(`
		SELECT projects.*, companies.name AS company_name, companies.owner_id
		FROM projects
		JOIN companies ON companies.id = projects.company_id
		WHERE projects.id = ?
	`, projectID)
}

func (a *app) userByEmail(email string) (User, error) {
	row, err := a.userRowByEmail(email)
	if err != nil {
		return User{}, err
	}
	return publicUser(row), nil
}

func (a *app) userByID(id int64) (User, error) {
	row, err := a.queryOne("SELECT * FROM crm_users WHERE id = ?", id)
	if err != nil {
		return User{}, err
	}
	return publicUser(row), nil
}

func (a *app) userRowByEmail(email string) (map[string]any, error) {
	return a.queryOne("SELECT * FROM crm_users WHERE lower(email) = lower(?)", email)
}

func (a *app) authUser(r *http.Request) (User, bool) {
	token := bearerToken(r)
	a.mu.RLock()
	id, ok := a.sessions[token]
	a.mu.RUnlock()
	if !ok {
		return User{}, false
	}
	user, err := a.userByID(id)
	return user, err == nil
}

func (a *app) createSession(userID int64) string {
	tokenBytes := make([]byte, 32)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)
	a.mu.Lock()
	a.sessions[token] = userID
	a.mu.Unlock()
	return token
}

func (a *app) canAccessProject(projectID int64, user User) bool {
	project, err := a.getProject(projectID)
	if err != nil {
		return false
	}
	if user.Role == "manager_owner" {
		return asInt64(project["owner_id"]) == user.ID || a.isProjectMember(projectID, user.ID)
	}
	return a.isProjectMember(projectID, user.ID)
}

func (a *app) isProjectMember(projectID, userID int64) bool {
	var count int
	_ = a.db.QueryRow("SELECT COUNT(*) FROM project_members WHERE project_id = ? AND user_id = ?", projectID, userID).Scan(&count)
	return count > 0
}

func (a *app) queryOne(query string, args ...any) (map[string]any, error) {
	rows, err := a.queryMaps(query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, sql.ErrNoRows
	}
	return rows[0], nil
}

func (a *app) queryMaps(query string, args ...any) ([]map[string]any, error) {
	rows, err := a.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, col := range cols {
			row[col] = normalizeSQLValue(values[i])
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (a *app) initDB() error {
	_, err := a.db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return err
	}
	var applied int
	_ = a.db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE id = 1").Scan(&applied)
	if applied == 0 {
		if _, err := a.db.Exec(schemaSQL); err != nil {
			return err
		}
		if _, err := a.db.Exec("INSERT INTO schema_migrations (id) VALUES (1)"); err != nil {
			return err
		}
	}
	if err := a.applyMigration(2, func() error {
		_, err := a.db.Exec("ALTER TABLE client_interactions ADD COLUMN email_reminder_sent_at TEXT")
		return err
	}); err != nil {
		return err
	}
	var count int
	_ = a.db.QueryRow("SELECT COUNT(*) FROM crm_users").Scan(&count)
	if count == 0 {
		return a.seedDB()
	}
	return nil
}

func (a *app) applyMigration(id int, fn func() error) error {
	var applied int
	_ = a.db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE id = ?", id).Scan(&applied)
	if applied > 0 {
		return nil
	}
	if err := fn(); err != nil {
		return err
	}
	_, err := a.db.Exec("INSERT INTO schema_migrations (id) VALUES (?)", id)
	return err
}

func (a *app) createDefaultCompanyProject(ownerID int64, companyName string) error {
	res, err := a.db.Exec("INSERT INTO companies (name, owner_id) VALUES (?, ?)", companyName, ownerID)
	if err != nil {
		return err
	}
	companyID, _ := res.LastInsertId()
	res, err = a.db.Exec("INSERT INTO projects (company_id, name, description) VALUES (?, ?, ?)", companyID, "Первый проект", "Базовый проект компании")
	if err != nil {
		return err
	}
	projectID, _ := res.LastInsertId()
	if _, err := a.db.Exec("INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'owner')", projectID, ownerID); err != nil {
		return err
	}
	return a.createDefaultStages(projectID)
}

func (a *app) createDefaultStages(projectID int64) error {
	stages := []string{"Лид", "Заинтересованность", "Квалификация", "Переговоры", "Сделка", "Отказ"}
	for i, name := range stages {
		_, err := a.db.Exec(`
			INSERT INTO funnel_stages (project_id, name, position, is_final_success, is_final_failed)
			VALUES (?, ?, ?, ?, ?)
		`, projectID, name, i+1, boolInt(name == "Сделка"), boolInt(name == "Отказ"))
		if err != nil {
			return err
		}
	}
	return nil
}

func (a *app) seedDB() error {
	password, err := hashPassword("demo123")
	if err != nil {
		return err
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	insertUser := func(first, last, email, role string) (int64, error) {
		res, err := tx.Exec(`
			INSERT INTO crm_users (first_name, last_name, email, password_hash, role)
			VALUES (?, ?, ?, ?, ?)
		`, first, last, email, password, role)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	owner, _ := insertUser("Мария", "Лебедева", "owner@crm.local", "manager_owner")
	ivan, _ := insertUser("Иван", "Петров", "ivan@crm.local", "sales_manager")
	anna, _ := insertUser("Анна", "Смирнова", "anna@crm.local", "sales_manager")

	company, _ := tx.Exec("INSERT INTO companies (name, owner_id) VALUES (?, ?)", "Demo Sales Company", owner)
	companyID, _ := company.LastInsertId()
	projectRes, _ := tx.Exec("INSERT INTO projects (company_id, name, description) VALUES (?, ?, ?)", companyID, "B2B Sales", "Демо-проект для проверки минимальной CRM-вертикали.")
	project, _ := projectRes.LastInsertId()
	_, _ = tx.Exec("INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'owner')", project, owner)
	_, _ = tx.Exec("INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'manager')", project, ivan)
	_, _ = tx.Exec("INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'manager')", project, anna)

	stage := func(name string, pos int, color string, won, lost bool, maxDays int) int64 {
		res, _ := tx.Exec(`
			INSERT INTO funnel_stages (project_id, name, position, color, is_final_success, is_final_failed, max_days_without_activity)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, project, name, pos, color, boolInt(won), boolInt(lost), maxDays)
		id, _ := res.LastInsertId()
		return id
	}
	stageLead := stage("Лид", 1, "#2f79c4", false, false, 3)
	stageInterest := stage("Заинтересованность", 2, "#7464c9", false, false, 5)
	stageNeed := stage("Квалификация", 3, "#2e8b7d", false, false, 7)
	stageTalk := stage("Переговоры", 4, "#c9832e", false, false, 7)
	stageWon := stage("Сделка", 5, "#2e8b7d", true, false, 14)
	stage("Отказ", 6, "#c85151", false, true, 14)

	client := func(manager, stage int64, name, desc string, contacts map[string]string, tags []string, amount int) int64 {
		contactsJSON, _ := json.Marshal(contacts)
		tagsJSON, _ := json.Marshal(tags)
		res, _ := tx.Exec(`
			INSERT INTO crm_clients
				(project_id, assigned_manager_id, current_stage_id, name, short_description, contacts, tags, deal_amount)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, project, manager, stage, name, desc, string(contactsJSON), string(tagsJSON), amount)
		id, _ := res.LastInsertId()
		return id
	}
	client1 := client(ivan, stageLead, "Олег Павлов", "Интересуется внедрением CRM для отдела продаж.", map[string]string{"phone": "+7 900 100-10-10", "email": "op@vector.ru", "telegram": "@opavlov"}, []string{"B2B", "новый лид"}, 180000)
	client2 := client(ivan, stageTalk, "Елена Смирнова", "Крупный клиент, обсуждает отчетность и контроль менеджеров.", map[string]string{"phone": "+7 900 400-40-40", "email": "es@sever.ru"}, []string{"enterprise", "важно"}, 450000)
	client3 := client(anna, stageNeed, "Павел Егоров", "Нужна автоматизация повторных продаж.", map[string]string{"phone": "+7 900 500-50-50", "email": "egorov@alpha.ru"}, []string{"повторные продажи"}, 320000)
	client(anna, stageInterest, "Светлана Ким", "Просит демонстрацию продукта для команды.", map[string]string{"phone": "+7 900 200-20-20", "email": "kim@example.ru"}, []string{"демо", "теплый"}, 120000)

	_, _ = tx.Exec("INSERT INTO client_notes (client_id, manager_id, message, source) VALUES (?, ?, ?, ?)", client1, ivan, "Оставил заявку на сайте. Нужно уточнить бюджет и сроки внедрения.", "manual")
	_, _ = tx.Exec("INSERT INTO client_notes (client_id, manager_id, message, source) VALUES (?, ?, ?, ?)", client2, ivan, "Отправлено коммерческое предложение. Клиент ждет согласование у директора.", "copied_from_social")
	_, _ = tx.Exec("INSERT INTO client_notes (client_id, manager_id, message, source) VALUES (?, ?, ?, ?)", client3, anna, "На встрече подтвердили потребность в контроле повторных касаний.", "meeting_summary")

	_, _ = tx.Exec("INSERT INTO client_interactions (client_id, manager_id, project_id, type, title, description, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", client1, ivan, project, "call", "Позвонить Олегу", "Уточнить требования и бюджет.", "2026-05-18T10:00", "planned")
	_, _ = tx.Exec("INSERT INTO client_interactions (client_id, manager_id, project_id, type, title, description, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", client2, ivan, project, "email", "Повторно отправить КП", "Клиент не ответил после первого письма.", "2026-05-16T11:30", "missed")
	_, _ = tx.Exec("INSERT INTO client_interactions (client_id, manager_id, project_id, type, title, description, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", client3, anna, project, "meeting", "Демо для отдела продаж", "Показать Kanban и отчеты.", "2026-05-19T15:00", "planned")
	_, _ = tx.Exec("INSERT INTO stage_transitions (client_id, project_id, manager_id, from_stage_id, to_stage_id, comment) VALUES (?, ?, ?, ?, ?, ?)", client2, project, ivan, stageNeed, stageTalk, "Клиент перешел к обсуждению договора.")
	_, _ = tx.Exec("INSERT INTO stage_transitions (client_id, project_id, manager_id, from_stage_id, to_stage_id, comment) VALUES (?, ?, ?, ?, ?, ?)", client3, project, anna, stageInterest, stageNeed, "Потребность подтверждена на встрече.")
	_, _ = tx.Exec("INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id) VALUES (?, ?, ?, ?, ?, ?)", ivan, "new_lead_assigned", "Новый клиент назначен", "Олег Павлов назначен вам в проекте B2B Sales.", "client", client1)
	_, _ = tx.Exec("INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id) VALUES (?, ?, ?, ?, ?, ?)", owner, "system", "Демо-данные готовы", "Можно проверить путь управляющего и менеджера.", "project", project)
	_, _ = tx.Exec("UPDATE crm_clients SET current_stage_id = ? WHERE id = ?", stageWon, client3)

	return tx.Commit()
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash, err := scrypt.Key([]byte(password), []byte(hex.EncodeToString(salt)), 1<<14, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(hash), nil
}

func verifyPassword(password, stored string) bool {
	parts := strings.Split(stored, ":")
	if len(parts) != 2 {
		return false
	}
	hash, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	candidate, err := scrypt.Key([]byte(password), []byte(parts[0]), 1<<14, 8, 1, 64)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(hash, candidate) == 1
}

func publicUser(row map[string]any) User {
	user := User{
		ID:        asInt64(row["id"]),
		FirstName: str(row["first_name"]),
		LastName:  str(row["last_name"]),
		Email:     str(row["email"]),
		Role:      str(row["role"]),
		CreatedAt: str(row["created_at"]),
		UpdatedAt: str(row["updated_at"]),
	}
	user.Name = strings.TrimSpace(user.FirstName + " " + user.LastName)
	return user
}

func normalizeClient(row map[string]any) {
	row["contacts"] = parseJSON(str(row["contacts"]), map[string]any{})
	row["tags"] = parseJSON(str(row["tags"]), []any{})
}

func normalizeTags(value any) []string {
	switch typed := value.(type) {
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if tag := strings.TrimSpace(str(item)); tag != "" {
				out = append(out, tag)
			}
		}
		return out
	case []string:
		return typed
	default:
		parts := strings.Split(str(value), ",")
		out := []string{}
		for _, part := range parts {
			if tag := strings.TrimSpace(part); tag != "" {
				out = append(out, tag)
			}
		}
		return out
	}
}

func parseJSON(raw string, fallback any) any {
	if raw == "" {
		return fallback
	}
	var out any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return fallback
	}
	return out
}

func normalizeSQLValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	default:
		return typed
	}
}

func readBody(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON")
		return false
	}
	return true
}

func writeResult(w http.ResponseWriter, data any, err error) {
	writeResultStatus(w, data, err, http.StatusOK)
}

func writeResultStatus(w http.ResponseWriter, data any, err error, status int) {
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "Запись не найдена")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, status, data)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func bearerToken(r *http.Request) string {
	return strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}

func splitPath(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func str(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case nil:
		return ""
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(typed)
	}
}

func asInt64(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		out, _ := typed.Int64()
		return out
	case nil:
		return 0
	default:
		out, _ := strconv.ParseInt(str(value), 10, 64)
		return out
	}
}

func asFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	case nil:
		return 0
	default:
		out, _ := strconv.ParseFloat(str(value), 64)
		return out
	}
}

func nullString(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}

func nullInt(value int64) sql.NullInt64 {
	return sql.NullInt64{Int64: value, Valid: value != 0}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

const schemaSQL = `
CREATE TABLE IF NOT EXISTS crm_users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	first_name TEXT NOT NULL,
	last_name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL CHECK(role IN ('sales_manager', 'manager_owner')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	owner_id INTEGER NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (owner_id) REFERENCES crm_users(id)
);

CREATE TABLE IF NOT EXISTS projects (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	company_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	description TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS project_members (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	role_in_project TEXT NOT NULL DEFAULT 'manager',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(project_id, user_id),
	FOREIGN KEY (project_id) REFERENCES projects(id),
	FOREIGN KEY (user_id) REFERENCES crm_users(id)
);

CREATE TABLE IF NOT EXISTS funnel_stages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	position INTEGER NOT NULL,
	color TEXT NOT NULL DEFAULT '#2e8b7d',
	is_final_success INTEGER NOT NULL DEFAULT 0,
	is_final_failed INTEGER NOT NULL DEFAULT 0,
	max_days_without_activity INTEGER NOT NULL DEFAULT 7,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS crm_clients (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id INTEGER NOT NULL,
	assigned_manager_id INTEGER,
	current_stage_id INTEGER,
	name TEXT NOT NULL,
	short_description TEXT,
	contacts TEXT NOT NULL DEFAULT '{}',
	tags TEXT NOT NULL DEFAULT '[]',
	deal_amount REAL NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'active',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (project_id) REFERENCES projects(id),
	FOREIGN KEY (assigned_manager_id) REFERENCES crm_users(id),
	FOREIGN KEY (current_stage_id) REFERENCES funnel_stages(id)
);

CREATE TABLE IF NOT EXISTS stage_transitions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	client_id INTEGER NOT NULL,
	project_id INTEGER NOT NULL,
	manager_id INTEGER,
	from_stage_id INTEGER,
	to_stage_id INTEGER NOT NULL,
	comment TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (client_id) REFERENCES crm_clients(id),
	FOREIGN KEY (project_id) REFERENCES projects(id),
	FOREIGN KEY (manager_id) REFERENCES crm_users(id),
	FOREIGN KEY (from_stage_id) REFERENCES funnel_stages(id),
	FOREIGN KEY (to_stage_id) REFERENCES funnel_stages(id)
);

CREATE TABLE IF NOT EXISTS client_notes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	client_id INTEGER NOT NULL,
	manager_id INTEGER NOT NULL,
	message TEXT NOT NULL,
	source TEXT NOT NULL DEFAULT 'manual',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (client_id) REFERENCES crm_clients(id),
	FOREIGN KEY (manager_id) REFERENCES crm_users(id)
);

CREATE TABLE IF NOT EXISTS client_interactions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	client_id INTEGER NOT NULL,
	manager_id INTEGER NOT NULL,
	project_id INTEGER NOT NULL,
	type TEXT NOT NULL DEFAULT 'call',
	title TEXT NOT NULL,
	description TEXT,
	scheduled_at TEXT NOT NULL,
	completed_at TEXT,
	status TEXT NOT NULL DEFAULT 'planned',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (client_id) REFERENCES crm_clients(id),
	FOREIGN KEY (manager_id) REFERENCES crm_users(id),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS notifications (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	type TEXT NOT NULL,
	title TEXT NOT NULL,
	body TEXT,
	related_entity_type TEXT,
	related_entity_id INTEGER,
	is_read INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES crm_users(id)
);
`
