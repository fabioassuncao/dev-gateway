# Projects, environments and services

A **Project** is the product you organize in Portta. It can contain multiple repositories and running environments.

An **Environment** is identified by its Compose project name. Each checkout or worktree needs a distinct namespace and its own volumes. A **Service** is a containerized component within that environment, such as `web` or `postgres`.

The example Project `demo-shop` can have an Environment named `demo-shop-development`, containing `web` and `postgres`. Only the HTTP service joins the gateway network. The database remains private.

Portta observes running state through Docker; it stores project associations and preferences in the panel database. These are separate sources of truth.

See [Manage projects](../guides/projects.md), [Manage environments](../guides/environments.md), and [Persistence](persistence.md).
