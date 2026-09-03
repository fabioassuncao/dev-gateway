# Portta: convenience wrapper around ./bin/portta.
#
# Make is a shortcut, never a requirement: every target below is a one-line
# call to the CLI, which is the stable operational contract.

SHELL := /bin/bash
GW    := ./bin/portta
# Make is checkout-only. Portta images are built from the Dockerfiles here,
# never pulled from the published registry. Third-party images stay pinned.
LOCAL_IMAGES := PORTTA_AUTH_IMAGE=fabioassuncao/portta:local \
	PORTTA_WEB_IMAGE=fabioassuncao/portta:local \
	PORTTA_WEB_BUILD=true

.DEFAULT_GOAL := help

.PHONY: help dev bootstrap up down restart status doctor urls logs inspect update \
        web web-dev web-down db-migrate test test-all test-e2e lint \
        demo-up demo-up-all demo-down demo-down-all examples

help: ## Show this help
	@printf 'Portta make targets\n\n'
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf '\nEverything here just calls %s.\n' '$(GW)'

# One command from a fresh clone to a running gateway with a hot-reloading
# panel. It is deliberately the only target that chains others: everything
# else stays a single call to the CLI. Pending panel SQL is applied after
# the panel is up; `db-migrate` does the same without a restart.
dev: ## Start the gateway and the panel; apply pending migrations
	@$(GW) dev $(PROFILE)

bootstrap: ## Prepare this checkout (no published Portta image pull)
	@$(GW) bootstrap --skip-pull

up: ## Start the gateway from local Dockerfiles (PROFILE=local by default)
	@$(LOCAL_IMAGES) $(GW) up $(PROFILE)

down: ## Stop the gateway; consumer projects keep running
	@$(GW) down

restart: ## Restart gateway components
	@$(GW) restart

status: ## Compact status overview
	@$(GW) status

doctor: ## Deep diagnostics
	@$(GW) doctor

urls: ## List the hostnames currently routed
	@$(GW) urls

logs: ## Follow gateway logs
	@$(GW) logs

inspect: ## Print the resolved configuration
	@$(GW) inspect

update: ## Pull pinned images and recreate
	@$(GW) update

web: ## Start the administration panel from the local runtime image
	@$(LOCAL_IMAGES) $(GW) web up

web-dev: ## Start the panel with hot reloading from the local dev image
	@$(LOCAL_IMAGES) $(GW) web dev

web-down: ## Stop the panel; the gateway keeps running
	@$(GW) web down

db-migrate: ## Apply pending panel SQL without restarting the panel
	@$(GW) db migrate

lint: ## Shell lint and compose validation
	@./tests/run.sh --lint

test: ## Fast suite: lint and unit tests
	@./tests/run.sh

test-e2e: ## End-to-end suites (requires Docker)
	@./tests/run.sh --e2e

test-all: ## Everything
	@./tests/run.sh --all

demo-up: ## Start every adopted demo (site, shop, monorepo, a, b)
	@cd docker/examples/demo-a && docker compose -f compose.yaml -f compose.portta.yaml up -d
	@cd docker/examples/demo-b && docker compose -f compose.yaml -f compose.portta.yaml up -d
	@cd docker/examples/demo-site && docker compose -f compose.yaml -f compose.portta.yaml up -d
	@cd docker/examples/demo-shop && docker compose -f compose.yaml -f compose.portta.yaml up -d
	@cd docker/examples/demo-monorepo && docker compose -f compose.yaml -f compose.portta.yaml up -d
	@$(GW) urls

demo-up-all: demo-up ## Alias for demo-up

examples: ## Import example projects and tasks into the panel (idempotent)
	@$(GW) examples apply

demo-down: ## Stop every example stack (including external) and drop volumes
	@cd docker/examples/demo-a && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-b && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-site && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-shop && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-monorepo && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-external && docker compose down -v

demo-down-all: demo-down ## Alias for demo-down
