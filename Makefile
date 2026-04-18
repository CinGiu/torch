.PHONY: dev dev-backend dev-frontend

# Start backend (Docker) + frontend dev server with HMR
dev:
	@echo "Starting backend..."
	docker compose -f docker-compose.dev.yml up -d
	@echo "Starting frontend dev server → http://localhost:5173"
	cd frontend && npm run dev

# Backend only (useful to restart without touching the frontend)
dev-backend:
	docker compose -f docker-compose.dev.yml up -d

# Rebuild backend image (after Go changes)
dev-rebuild:
	docker compose -f docker-compose.dev.yml up -d --build torch

dev-stop:
	docker compose -f docker-compose.dev.yml down
