gcloud run deploy livetranslate \
    --source . \
    --region us-central1 \
    --allow-unauthenticated \
    --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,APP_PASSWORD=app-password:latest" \
    --set-env-vars="APP_USERNAME=andre" \
    --min-instances=0 \
    --max-instances=1