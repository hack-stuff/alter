# Build from the repository root.
FROM python:3.12-slim
WORKDIR /srv/api
COPY services/api/pyproject.toml services/api/requirements.lock ./
COPY services/api/app ./app
COPY services/api/seed ./seed
RUN pip install --no-cache-dir -c requirements.lock .
USER 65532:65532
ENV PORT=8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
