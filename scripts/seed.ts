import { buildApp } from '@/app'
import { seed } from '@/db/seed'
import { loadConfig } from '@/lib/config'

const app = await buildApp({ config: loadConfig() })

await seed(app.db)
app.log.info('seed complete')
await app.close()
