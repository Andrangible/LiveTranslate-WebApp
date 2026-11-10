#!/usr/bin/env bash
# Déploie la version statique (web/) sur Firebase Hosting (offre gratuite Spark).
# Prérequis (une seule fois) : firebase login, puis firebase use --add.
# La version d'origine (Cloud Run) se déploie toujours avec ./deploy.sh.
set -euo pipefail
cd "$(dirname "$0")"
firebase deploy --only hosting "$@"
