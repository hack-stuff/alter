#!/usr/bin/env bash
# Run from the repository root after editing a gitignored local environment file.
set -euo pipefail
: "${GCP_PROJECT:?Set GCP_PROJECT}"
: "${GCP_REGION:=us-central1}"
: "${API_ENV_FILE:?Set API_ENV_FILE to a local Cloud Run env YAML}"
: "${SERVICE_URL:?Set the public HTTPS Cloud Run URL, also used inside API_ENV_FILE}"
: "${A2A_SECRET_ID:?Set the existing A2A HMAC secret ID}"
: "${OAUTH_SECRET_ID:?Set the existing demo OAuth secret ID}"
: "${DIRECTOR_SECRET_ID:?Set the existing director secret ID}"
if [[ ! -r "$API_ENV_FILE" ]]; then echo 'API_ENV_FILE must name a readable environment YAML file.' >&2; exit 1; fi
if grep -q REPLACE_ "$API_ENV_FILE"; then echo 'Replace all environment placeholders first.' >&2; exit 1; fi
api_account="alter-api@${GCP_PROJECT}.iam.gserviceaccount.com"
scheduler_account="alter-scheduler@${GCP_PROJECT}.iam.gserviceaccount.com"
image="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/alter/alter-api:$(git rev-parse --short HEAD)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com identitytoolkit.googleapis.com drive.googleapis.com docs.googleapis.com sheets.googleapis.com calendar-json.googleapis.com gmail.googleapis.com --project="$GCP_PROJECT"
if ! gcloud artifacts repositories describe alter --location="$GCP_REGION" --project="$GCP_PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create alter --repository-format=docker --location="$GCP_REGION" --project="$GCP_PROJECT"
fi
for account in alter-api alter-scheduler; do
  if ! gcloud iam service-accounts describe "${account}@${GCP_PROJECT}.iam.gserviceaccount.com" --project="$GCP_PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account" --project="$GCP_PROJECT"
  fi
done
for role in roles/datastore.user roles/aiplatform.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:${api_account}" --role="$role" --condition=None >/dev/null
done
for secret_id in "$A2A_SECRET_ID" "$OAUTH_SECRET_ID" "$DIRECTOR_SECRET_ID"; do
  gcloud secrets add-iam-policy-binding "$secret_id" --project="$GCP_PROJECT" --member="serviceAccount:${api_account}" --role=roles/secretmanager.secretAccessor >/dev/null
done
gcloud builds submit --project="$GCP_PROJECT" --config=infra/cloudbuild.yaml --substitutions="_IMAGE=${image}" .
gcloud run deploy alter-api --project="$GCP_PROJECT" --region="$GCP_REGION" --image="$image" --service-account="$api_account" --env-vars-file="$API_ENV_FILE" --allow-unauthenticated --min-instances=1 --max-instances=3 --cpu=1 --memory=1Gi --no-cpu-throttling --timeout=180 --concurrency=20
# The public HTTP endpoint verifies Firebase, A2A HMAC, or scheduler OIDC itself.
actual_url="$(gcloud run services describe alter-api --project="$GCP_PROJECT" --region="$GCP_REGION" --format='value(status.url)')"
# Cloud Run may display the deterministic URL while status.url contains the
# equivalent service-hash URL. Both identify this deployed service.
project_number="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
deterministic_url="https://alter-api-${project_number}.${GCP_REGION}.run.app"
SERVICE_URL="${SERVICE_URL%/}"
if [[ "$SERVICE_URL" != "${actual_url%/}" && "$SERVICE_URL" != "$deterministic_url" ]]; then
  echo "Configured SERVICE_URL does not match this service. Use $actual_url or $deterministic_url, and set SCHEDULER_AUDIENCE to the same URL." >&2
  exit 1
fi
job_args=(--project="$GCP_PROJECT" --location="$GCP_REGION" --schedule='*/15 * * * *' --uri="${SERVICE_URL}/internal/cleanup" --http-method=POST --oidc-service-account-email="$scheduler_account" --oidc-token-audience="$SERVICE_URL" --time-zone=Etc/UTC --attempt-deadline=180s)
if gcloud scheduler jobs describe alter-cleanup --project="$GCP_PROJECT" --location="$GCP_REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http alter-cleanup "${job_args[@]}"
else
  gcloud scheduler jobs create http alter-cleanup "${job_args[@]}"
fi
curl --fail --silent --show-error "${SERVICE_URL}/readyz"
echo 'Deploy Firestore rules/indexes and Hosting after reviewing the project target: firebase deploy --project "$GCP_PROJECT" --only firestore,hosting'
