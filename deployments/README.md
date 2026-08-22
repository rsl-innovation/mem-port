# Deployments

| Folder | What it is |
|---|---|
| [`docker/`](docker/) | The container image, and a Compose stack that runs mem-port against a hosted SurrealDB the way a real deployment does |
| [`gcp/`](gcp/) | Cloud Run service definition and a deploy script |

## Read this first

**mem-port has no authentication.** The `library-id` header selects a tenant; it
does not prove a right to that tenant. Anything that can reach `POST /mcp` can
read and write any library by naming it.

Locally that is fine, because the daemon binds `127.0.0.1` and the operating
system is the boundary. A deployment removes that boundary, so something else
has to provide one. Until app-level auth exists, everything here defaults to
closed: Compose publishes on loopback only, and the Cloud Run service uses
internal ingress with invoker auth required.

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
