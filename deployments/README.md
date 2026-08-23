# Deployments

| Folder | What it is |
|---|---|
| [`docker/`](docker/) | The container image, and a Compose stack that runs mem-port against a hosted SurrealDB the way a real deployment does |
| [`gcp/`](gcp/) | Cloud Run service definition and a deploy script |

## Read this first

**Authentication follows exposure.** On loopback it is off, because the
operating system is already the boundary. On any other interface it is
required, so a deployed daemon is closed by default rather than depending on
whoever wrote the deploy config.

That means a deployment needs a bootstrap admin, or it will refuse to start:

```
MEM_PORT_ADMIN_USER=admin
MEM_PORT_ADMIN_PASSWORD=<a real secret, from Secret Manager>
```

Then sign in at `/admin` to create workspaces, add users, issue their API keys
and grant access. Clients send `Authorization: Bearer <key>` alongside
`library-id`.

The manifests here still default to closed at the network layer as well —
Compose publishes on loopback, Cloud Run uses internal ingress with invoker auth
required — because defence in depth is cheap and an exposed admin panel is worth
one more lock.

## The other thing that changes when you deploy

The default embedded database (`surrealkv://`) writes to local disk. That is
wrong anywhere the filesystem is ephemeral or more than one instance runs — you
would lose data when a container is replaced, and replicas would silently
diverge. **A hosted SurrealDB is required**, with three constraints checked at
startup:

- server **3.0.0+** — sessions and transactions are 3.0 features, and mem-port
  needs both (a session per library-id for tenancy, a transaction for
  `import_library`)
- **`ws://` or `wss://`** — the HTTP engine supports neither, at any version
- a **root- or namespace-level user** — mem-port creates a database per
  library-id and defines its schema on first use

## Local

```bash
docker compose -f deployments/docker/docker-compose.yml up --build

# if a locally installed mem-port already holds 8787:
MEM_PORT_HOST_PORT=8799 docker compose -f deployments/docker/docker-compose.yml up --build
```

Brings up SurrealDB 3 with a volume, and mem-port pointed at it over `ws://`.
Configuration is [`.env.example`](../.env.example); copy it to `.env` for local
runs of the daemon outside Docker.

## Cloud Run

```bash
PROJECT_ID=my-project REGION=us-central1 ./deployments/gcp/deploy.sh
```

See [`gcp/README.md`](gcp/README.md) for what to set up first and how clients
connect.
