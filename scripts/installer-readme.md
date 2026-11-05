# Brainded MCP

Install the release tarball with Node.js 24 or newer.

```text
npm install --global ./brainded-mcp-0.1.0.tgz
brain-mcp --check
brain-mcp --config
```

Add the generated `ai-brain` entry to your local MCP client and reconnect.
The command in the entry launches Brainded over stdio. In the client, call
`brain_status` to verify the connection. The default database lives at
`~/.brainded/brain.db`. Pass an absolute database path after `--check` or
`--config` to select an existing database.

npm installs the dependencies for your platform. The local embedding model is
downloaded on first semantic use and cached in `~/.brainded/models`. SQLite
storage and keyword lookup are available when embeddings are unavailable.
Set `BRAIN_MODEL_CACHE_DIR` to use a different cache, or set
`BRAIN_LOCAL_FILES_ONLY=1` to restrict model loading to the local cache.
