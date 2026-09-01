# Portta: convenience wrapper around ./bin/portta.
#
# Make is a shortcut, never a requirement: every target below is a one-line
# call to the CLI, which is the stable operational contract.

SHELL := /bin/bash
GW    := ./bin/portta

.DEFAULT_GOAL := help

.PHONY: help bootstrap up down restart status doctor urls logs inspect update \
        web web-dev web-down test test-all test-e2e lint \
        demo-up demo-up-all demo-down demo-down-all

help: ## Show this help
	@printf 'Portta make targets\n\n'
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf '\nEverything here just calls %s.\n' '$(GW)'

bootstrap: ## Prepare this host to run the gateway
	@$(GW) bootstrap

up: ## Start the gateway (PROFILE=local by default)
	@$(GW) up $(PROFILE)

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

web: ## Start the administration panel on loopback
	@$(GW) web up

web-dev: ## Start the panel with hot reloading
	@$(GW) web dev

web-down: ## Stop the panel; the gateway keeps running
	@$(GW) web down

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

demo-down: ## Stop every example stack (including external) and drop volumes
	@cd docker/examples/demo-a && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-b && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-site && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-shop && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-monorepo && docker compose -f compose.yaml -f compose.portta.yaml down -v
	@cd docker/examples/demo-external && docker compose down -v

demo-down-all: demo-down ## Alias for demo-down
