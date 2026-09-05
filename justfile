# Portta: convenience wrapper around ./bin/portta.
#
# Just is a shortcut, never a requirement: every recipe below is a one-line
# call to the CLI, which is the stable operational contract. Flags go through
# as written: `just up --demo`, `just reset --yes --demo`.

# Checkout-only. Portta images are built from the Dockerfiles here, never
# pulled from the published registry. Third-party images stay pinned.
gw := "./bin/portta"
release := `tr -d '[:space:]' < VERSION`
release_image := "fabioassuncao/portta:" + release

[private]
default:
    @just --list

# Build every Portta-owned image for the release in VERSION
build:
    @{{gw}} build

# Start the gateway from the already-built local release
up *args:
    @PORTTA_LOCAL_RELEASE=true PORTTA_AUTH_IMAGE={{release_image}} PORTTA_WEB_IMAGE={{release_image}} PORTTA_WEB_BUILD=false PORTTA_WEB_DEV=false {{gw}} up {{args}}

# Start the gateway and the panel with hot reloading
dev *args:
    @{{gw}} dev {{args}}

# Stop the gateway; consumer projects keep running unless --demo
down *args:
    @{{gw}} down {{args}}

# Wipe the panel database and start like a fresh clone
reset *args:
    @{{gw}} reset {{args}}

# Prepare this checkout (no published Portta image pull)
bootstrap *args:
    @{{gw}} bootstrap --skip-pull {{args}}

# Restart gateway components
restart *args:
    @{{gw}} restart {{args}}

# Compact status overview
status *args:
    @{{gw}} status {{args}}

# Deep diagnostics
doctor *args:
    @{{gw}} doctor {{args}}

# List the hostnames currently routed
urls *args:
    @{{gw}} urls {{args}}

# Follow gateway logs
logs *args:
    @{{gw}} logs {{args}}

# Print the resolved configuration
inspect *args:
    @{{gw}} inspect {{args}}

# Pull pinned images and recreate
update *args:
    @{{gw}} update {{args}}

# Panel: up, dev, down, ...
web *args:
    @PORTTA_LOCAL_RELEASE=true PORTTA_AUTH_IMAGE={{release_image}} PORTTA_WEB_IMAGE={{release_image}} PORTTA_WEB_BUILD=false PORTTA_WEB_DEV=false {{gw}} web {{args}}

# Apply pending panel SQL without restarting the panel
db-migrate:
    @{{gw}} db migrate

# Fast suite; pass --lint, --e2e or --all
test *args:
    @./tests/run.sh {{args}}
