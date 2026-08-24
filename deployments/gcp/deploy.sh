#!/usr/bin/env bash
#
# Build mem-port, push it to Artifact Registry, and deploy to Cloud Run.
#
#   PROJECT_ID=my-project REGION=us-central1 ./deployments/gcp/deploy.sh
#
# Safe to re-run: every step is create-if-missing.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-mem-port}"
REPO="${REPO:-mem-port}"
# Tag by commit rather than :latest, so a rollback names an exact build.
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${TAG}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> project=${PROJECT_ID} region=${REGION} image=${IMAGE}"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com --project="$PROJECT_ID"

echo "==> Ensuring Artifact Registry repository"
gcloud artifacts repositories describe "$REPO" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$REGION" \
    --description="mem-port container images" --project="$PROJECT_ID"

echo "==> Building and pushing"
# --platform matters: Cloud Run runs linux/amd64, and building on an Apple
# Silicon machine produces arm64 by default, which fails to start with an
# exec-format error that does not name the architecture as the cause.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet --project="$PROJECT_ID"
  docker build --platform linux/amd64 -f deployments/docker/Dockerfile -t "$IMAGE" .
  docker push "$IMAGE"
else
  echo "    (no local docker; building with Cloud Build)"
  gcloud builds submit --tag "$IMAGE" --project="$PROJECT_ID" .
fi

echo "==> Checking required secrets"
for SECRET in mem-port-db-pass mem-port-admin-pass; do
  gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1 || MISSING="${MISSING:-}$SECRET "
done
if [ -n "${MISSING:-}" ]; then
  echo "    Missing secret(s): $MISSING" >&2
  cat >&2 <<'MSG'

    mem-port needs two secrets: the database password, and the bootstrap admin
    password (without which the service will not start, because binding
    0.0.0.0 makes authentication required).

      printf 'your-database-password' | gcloud secrets create mem-port-db-pass --data-file=-
      printf 'your-admin-password'    | gcloud secrets create mem-port-admin-pass --data-file=-

    Then grant the service account access to each — see deployments/gcp/README.md.

MSG
  exit 1
fi

echo "==> Deploying"
RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
sed -e "s|IMAGE|${IMAGE}|g" deployments/gcp/cloudrun.yaml > "$RENDERED"
gcloud run services replace "$RENDERED" --region="$REGION" --project="$PROJECT_ID"

# mem-port has no authentication of its own. Until it does, Cloud Run's invoker
# check is the only thing standing between the MCP endpoint and any caller, so
# this script never grants allUsers. Making it public is a deliberate act:
#   gcloud run services add-iam-policy-binding ... --member=allUsers
echo "==> Leaving invoker auth required (ingress is internal). See deployments/gcp/README.md."

gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)' | sed 's/^/==> Service URL: /'
