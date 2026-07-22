.PHONY: dev test vet build docker lint typecheck frontend-test

dev:
	docker compose up --build

test:
	cd backend && go test ./...

vet:
	cd backend && go vet ./...

build:
	cd backend && go build ./cmd/server

docker:
	docker compose up --build

lint:
	cd frontend && npm run lint

typecheck:
	cd frontend && npm run typecheck

frontend-test:
	cd frontend && npm run test

