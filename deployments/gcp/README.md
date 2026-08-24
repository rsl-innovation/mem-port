# mem-port on Cloud Run

## Before the first deploy

**1. A database the service can reach.** Either engine works — see
[`../README.md`](../README.md) for the constraints on each.

*Cloud SQL for Postgres* is usually the lighter option here: managed, backed up,
and pgvector is available. Create the instance, then enable the extension once:

```bash
gcloud sql instances create mem-port --database-version=POSTGRES_16 \
  --tier=db-g1-small --region="$REGION"
gcloud sql databases create memport --instance=mem-port
# then, connected to that database:  CREATE EXTENSION vector;
```

Point mem-port at it with the commented `MEM_PORT_DB_URL` in
[`cloudrun.yaml`](cloudrun.yaml) and add the `cloudsql-instances` annotation it
describes. Cloud Run mounts a Unix socket for the instance, so nothing traverses
the network.

*SurrealDB* means Surreal Cloud or SurrealDB on a VM: 3.0+, over `ws://`/`wss://`,
with a root- or namespace-level user. On a private address, keep the VPC
annotations in `cloudrun.yaml`; if it is public with TLS, remove them and use
`wss://`.

**2. Two secrets.** The database password, and the bootstrap admin password —
without the second the service will not start, because binding `0.0.0.0` makes
authentication required.

```bash
printf 'your-database-password' | gcloud secrets create mem-port-db-pass --data-file=-
printf 'your-admin-password'    | gcloud secrets create mem-port-admin-pass --data-file=-

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
for SECRET in mem-port-db-pass mem-port-admin-pass; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

**3. Edit `MEM_PORT_DB_URL`** in [`cloudrun.yaml`](cloudrun.yaml) to point at your
database.

## Deploy

```bash
PROJECT_ID=my-project REGION=us-central1 ./deployments/gcp/deploy.sh
```

Builds `linux/amd64` explicitly — an image built on Apple Silicon is arm64 by
default and fails to start on Cloud Run with an exec-format error that does not
mention architecture. Falls back to Cloud Build when Docker is not running.

Images are tagged with the git short SHA, so rolling back names an exact build
rather than chasing `:latest`.

## Access — the part that is not finished

The service deploys with `ingress: internal` and invoker auth required, and the
deploy script will not grant `allUsers`. That is deliberate: **mem-port itself
does not authenticate anyone.** Making the service public today would let any
caller read and write any library by guessing a `library-id`.

So today it is reachable from inside the VPC, or from your machine through a
proxy:

```bash
gcloud run services proxy mem-port --region="$REGION"
# then point an MCP client at http://127.0.0.1:8080/mcp
```

Client configuration is unchanged from a local daemon — same `POST /mcp`, same
`library-id` header. Only the URL differs.

A per-user key and workspace model is the next piece of work. Once it lands,
this becomes safe to expose directly, and the change here is the ingress
annotation plus an invoker binding.

## Sizing notes

The values in [`cloudrun.yaml`](cloudrun.yaml) are chosen, not defaults:

- **`containerConcurrency: 8`** — Node is single threaded and embedding
  inference is CPU-bound; the platform default of 80 queues work behind one
  busy request.
- **`memory: 1Gi`** — the ONNX runtime plus the model does not fit comfortably
  in 512Mi.
- **`cpu-throttling: false`** — CPU is throttled to near zero between requests
  by default, which can drop the idle WebSocket to SurrealDB. The SDK
  reconnects, but keeping CPU allocated avoids the churn.
- **`minScale: 1`** — avoids paying model load and the WebSocket handshake on
  the first request after an idle period. Set to `0` to trade cold starts for
  cost.
- **`MEM_PORT_DB_MAX_SESSIONS: 64`** — per instance, so the cluster sees this
  times `maxScale`.
