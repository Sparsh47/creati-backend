#!/bin/bash
echo "🚀 Running production migrations from local machine..."

# Set production database URL
export DATABASE_URL="postgresql://postgres.oemqdzeoycyvwgzqjgzz:kEZ02sKYZiwmdQAn@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Run migration
npx prisma migrate deploy

echo "✅ Production migrations completed!"
