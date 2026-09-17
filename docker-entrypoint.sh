#!/bin/sh
set -e

mkdir -p /app/public/uploads /app/.debug/facebook-errors
chown -R nextjs:nodejs /app/public/uploads /app/.debug

exec su-exec nextjs:nodejs sh -c 'npx prisma migrate deploy && npx prisma db seed && exec node server.js'
