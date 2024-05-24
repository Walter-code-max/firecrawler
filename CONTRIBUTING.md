# Contributors guide:

Welcome to [Firecrawl](https://firecrawl.dev) 🔥! Here are some instructions on how to get the project locally, so you can run it on your own (and contribute)

If you're contributing, note that the process is similar to other open source repos i.e. (fork firecrawl, make changes, run tests, PR). If you have any questions, and would like help gettin on board, reach out to hello@mendable.ai for more or submit an issue!

## Running the project locally

First, start by installing dependencies

1. node.js [instructions](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs)
2. pnpm [instructions](https://pnpm.io/installation)
3. redis [instructions](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/)

Set environment variables in a .env in the /apps/api/ directoryyou can copy over the template in .env.example.

To start, we wont set up authentication, or any optional sub services (pdf parsing, JS blocking support, AI features )

.env:

```
# ===== Required ENVS ======
NUM_WORKERS_PER_QUEUE=8
PORT=3002
HOST=0.0.0.0
REDIS_URL=redis://localhost:6379

## To turn on DB authentication, you need to set up supabase.
USE_DB_AUTHENTICATION=false

# ===== Optional ENVS ======

# Supabase Setup (used to support DB authentication, advanced logging, etc.)
SUPABASE_ANON_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_TOKEN=

# Other Optionals
TEST_API_KEY= # use if you've set up authentication and want to test with a real API key
SCRAPING_BEE_API_KEY= #Set if you'd like to use scraping Be to handle JS blocking
OPENAI_API_KEY= # add for LLM dependednt features (image alt generation, etc.)
BULL_AUTH_KEY= #
LOGTAIL_KEY= # Use if you're configuring basic logging with logtail
PLAYWRIGHT_MICROSERVICE_URL=  # set if you'd like to run a playwright fallback
LLAMAPARSE_API_KEY= #Set if you have a llamaparse key you'd like to use to parse pdfs
SERPER_API_KEY= #Set if you have a serper key you'd like to use as a search api
SLACK_WEBHOOK_URL= # set if you'd like to send slack server health status messages
POSTHOG_API_KEY= # set if you'd like to send posthog events like job logs
POSTHOG_HOST= # set if you'd like to send posthog events like job logs


```

### Installing dependencies

First, install the dependencies using pnpm.

```bash
pnpm install
```

### Running the project

You're going to need to open 3 terminals.

### Terminal 1 - setting up redis

Run the command anywhere within your project

```bash
redis-server
```

### Terminal 2 - setting up workers

Now, navigate to the apps/api/ directory and run:

```bash
pnpm run workers
```

This will start the workers who are responsible for processing crawl jobs.

### Terminal 3 - setting up the main server

To do this, navigate to the apps/api/ directory and run if you don’t have this already, install pnpm here: https://pnpm.io/installation
Next, run your server with:

```bash
pnpm run start
```

### Terminal 3 - sending our first request.

Alright: now let’s send our first request.

```curl
curl -X GET http://localhost:3002/test
```

This should return the response Hello, world!

If you’d like to test the crawl endpoint, you can run this

```curl
curl -X POST http://localhost:3002/v0/crawl \
    -H 'Content-Type: application/json' \
    -d '{
      "url": "https://mendable.ai"
    }'
```

## Tests:

The best way to do this is run the test with `npm run test:local-no-auth` if you'd like to run the tests without authentication.

If you'd like to run the tests with authentication, run `npm run test:prod`
