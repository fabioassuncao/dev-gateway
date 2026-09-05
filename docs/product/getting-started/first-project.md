# Add your first project

A Project groups repositories and environments belonging to the same product. An Environment is one Compose namespace.

## Prerequisites

Complete [Configure your first environment](first-environment.md) and open the Portta panel.

## Find the environment

1. Open **Environments** and find `demo-shop-development`.
2. Verify its working directory and services belong to your checkout.
3. Open **Projects**, choose **New project**, enter `Demo shop` as the name and `demo-shop` as the slug, then choose **Create**. Use an account allowed to create Projects.
4. Open the Project. The `--project demo-shop` integration label associates the environment with this existing Project; the label does not create the Project itself.
5. Inspect its **Environments** and **Repositories**. If the environment has no label, use **Adopt an environment** to select it explicitly.

## Expected result

Your Project and running environment are visible without moving the repository or sharing another environment's state. If they are missing, use [Troubleshooting](../guides/troubleshooting.md) and verify the labels described in [Add an existing project](../guides/adopting-projects.md).

See [Manage projects](../guides/projects.md) for ongoing administration.
