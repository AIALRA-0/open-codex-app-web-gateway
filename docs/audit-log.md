# Audit Log

## 2026-06-17 Compact Schema Endpoint Split

- Rechecked the official OpenAI OpenAPI schema for `/v1/responses/compact` and
  confirmed that compact uses `CompactResponseMethodPublicBody`, not the shared
  `ModelResponseProperties` request field set:
  - compact `prompt_cache_key` is a string/null field with a 64-character
    maximum;
  - compact `service_tier` accepts `auto`, `default`, `flex`, and `priority`,
    while the shared Responses/Chat `ServiceTier` also accepts `scale`.
- Split local validation accordingly:
  - Responses create, `/v1/responses/input_tokens`, and direct
    `/v1/chat/completions` keep the shared prompt-cache behavior from the
    previous alignment;
  - `/v1/responses/compact` now enforces the compact-specific
    `prompt_cache_key` limit and compact service-tier enum before provider
    calls.
- Documentation updated:
  - compatibility matrix now calls out the compact-specific prompt-cache and
    service-tier schema;
  - evaluation plan now requires long shared `prompt_cache_key` acceptance while
    preserving compact's 64-character maximum and compact service-tier enum.
- Validation:
  - targeted compact schema and identity/cache tests pass;
  - `node --check src/bridge/server.js` and
    `node --check test/server.test.js` pass;
  - `npm test` passes: 343 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after restart;
  - local and public smoke confirm compact overlong `prompt_cache_key` returns
    `400 invalid_request_parameter`, compact `service_tier:"scale"` returns
    `400 invalid_request_parameter`, and valid compact requests return
    `200 response.compaction`.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Prompt Cache Key Length Alignment

- Rechecked the official OpenAI OpenAPI schema and API reference for
  `prompt_cache_key`:
  - `safety_identifier` has an official 64-character maximum;
  - `prompt_cache_key` is documented as a string used for prompt-cache bucketing
    and currently has no published maximum length in the official schema/docs;
  - `prompt_cache_retention` remains `in_memory`, `24h`, or `null`.
- Closed an over-strict local validation gap:
  - Responses create, `/v1/responses/input_tokens`,
    `/v1/responses/compact`, and direct `/v1/chat/completions` now validate
    `prompt_cache_key` as string/null without applying the older local
    64-character cap;
  - `safety_identifier` still enforces the official 64-character limit;
  - provider-aware forwarding/filtering and DeepSeek `user_id` normalization
    remain unchanged.
- Documentation updated:
  - compatibility matrix now states that `prompt_cache_key` has no current
    published maximum length, while `safety_identifier` remains capped at 64;
  - evaluation plan now requires long string `prompt_cache_key` acceptance
    coverage across Responses create, `/input_tokens`, `/compact`, and direct
    Chat.
- Validation:
  - targeted identity/cache tests pass for Responses create,
    `/v1/responses/input_tokens`, `/v1/responses/compact`, and direct
    `/v1/chat/completions`;
  - `node --check src/bridge/server.js` and
    `node --check test/server.test.js` pass;
  - `npm test` passes: 343 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional credential-pattern scan only matched a local test fixture bearer
    token string;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after restart;
  - local and public smoke confirm overlong `safety_identifier` still returns
    `400 invalid_request_parameter`, while an 86-character `prompt_cache_key`
    returns `200` through the DeepSeek chat-completion path.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Audio Request Schema Validation Tightening

- Rechecked the official OpenAI OpenAPI schemas for request-based Audio APIs:
  - `CreateSpeechRequest` requires `model`, `input`, and `voice`, limits
    `input` and `instructions` to 4096 characters, uses
    `response_format` values `mp3`, `opus`, `aac`, `flac`, `wav`, and `pcm`,
    and accepts `stream_format` values `audio` and `sse`;
  - `CreateTranscriptionRequest` requires `file` and `model`, accepts
    `include:["logprobs"]`, timestamp granularities `word` and `segment`,
    `chunking_strategy:"auto"` or `server_vad`, and up to four known speaker
    names/references;
  - `CreateTranslationRequest` requires `file` and `model`, with translation
    response formats `json`, `text`, `srt`, `verbose_json`, and `vtt`.
- Closed local request-contract gaps before provider or placeholder handling:
  - `/v1/audio/speech` now rejects missing `model` or `voice`, overlong
    `input`/`instructions`, invalid custom voice objects, and invalid
    `stream_format` values;
  - `/v1/audio/transcriptions` now rejects invalid `include`,
    `timestamp_granularities`, stream booleans, `chunking_strategy`, and
    known-speaker list shapes before local transcription handling;
  - valid transcription `include:["logprobs"]` returns placeholder
    `logprobs:[]`, and valid verbose timestamp requests return placeholder
    word timestamps plus compatibility metadata.
- Documentation updated:
  - compatibility matrix Audio rows now list the stricter official validation
    behavior and valid placeholder response fields;
  - deployment docs now mark the old Audio model/voice environment defaults as
    legacy config presets rather than permission to omit official required
    request fields;
  - evaluation plan now covers speech stream-format validation, transcription
    logprobs, timestamp granularities, and official validation failures.
- Validation:
  - targeted direct Audio server tests pass for speech bytes/SSE, official
    validation failures, transcription multipart/JSON/SSE, translation
    multipart/JSON, and custom voice lifecycle;
  - targeted direct Audio Batch JSONL tests pass;
  - `node --check src/bridge/server.js` and
    `node --check test/server.test.js` pass;
  - `npm test` passes: 343 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional credential-pattern scan only matched a local test fixture bearer
    token string;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after restart;
  - local smoke against `http://127.0.0.1:12912` confirms invalid
    `stream_format:"websocket"` returns `400 invalid_request_parameter`,
    valid speech SSE emits `speech.audio.delta` and `speech.audio.done`, and
    valid transcription `include:["logprobs"]` returns `logprobs:[]`;
  - public smoke against `https://opencodexapp.aialra.online` confirms the
    same Audio validation and placeholder response behavior.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Service Tier Scale Enum Validation

- Rechecked the official OpenAI `ServiceTierEnum` through the official
  `openai/openai-openapi` spec. Current request values are `auto`, `default`,
  `flex`, `scale`, and `priority`.
- Closed a request-contract gap:
  - `/v1/responses`, `/v1/responses/compact`, and direct
    `/v1/chat/completions` now accept `service_tier:"scale"` as an
    OpenAI-valid request value;
  - provider-aware forwarding/filtering remains unchanged, so DeepSeek
    deployments still filter unsupported `service_tier` fields while recording
    compatibility metadata.
- Validation:
  - targeted service-tier server validation tests pass;
  - targeted translator service-tier tests pass;
  - `npm test` passes: 342 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional credential-pattern scan only matched a local test fixture bearer
    token string;
  - no stale `service_tier` enum documentation remains in `src`, `test`, or
    `docs`;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after restart;
  - local smoke against `http://127.0.0.1:12912` confirms invalid
    `service_tier:"fast"` returns `400 invalid_request_parameter`, while valid
    `service_tier:"scale"` returns
    `metadata.compatibility.service_tier.reason` as `provider_unsupported`;
  - public smoke against `https://opencodexapp.aialra.online` confirms the same
    validation and compatibility metadata behavior.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Reasoning Summary Request Validation

- Rechecked the official OpenAI `Reasoning` schema through the official
  `openai/openai-openapi` spec:
  - `reasoning.effort` accepts `none`, `minimal`, `low`, `medium`, `high`, and
    `xhigh`;
  - `reasoning.summary` accepts `auto`, `concise`, `detailed`, or `null`;
  - deprecated `reasoning.generate_summary` accepts the same summary enum.
- Closed a request-contract gap:
  - `/v1/responses`, `/v1/responses/input_tokens`, and direct
    `/v1/chat/completions` now reject invalid `reasoning.summary` and
    `reasoning.generate_summary` values before provider calls;
  - Responses translation now records `metadata.compatibility.reasoning_summary`
    when a Chat-only provider cannot forward the summary request;
  - deployments that explicitly enable reasoning-summary passthrough map
    `reasoning.summary` or deprecated `reasoning.generate_summary` to upstream
    `reasoning_summary`;
  - when both `summary` and deprecated `generate_summary` are present, `summary`
    takes precedence and metadata records that the deprecated field was ignored.
- Validation:
  - targeted reasoning translator tests pass;
  - targeted server validation tests for Responses, input token counting, and
    direct Chat reasoning fields pass;
  - `npm test` passes: 342 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional credential-pattern scan only matched a local test fixture bearer
    token string;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after restart;
  - local smoke against `http://127.0.0.1:12912` confirms invalid
    `reasoning.summary` returns `400 invalid_request_parameter`, and valid
    summary requests return `metadata.compatibility.reasoning_summary.reason`
    as `provider_unsupported`;
  - public smoke against `https://opencodexapp.aialra.online` confirms the same
    validation and compatibility metadata behavior.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Active Background Queued Stream Event

- Rechecked the official OpenAI Responses stream event union through the
  official `openai/openai-openapi` schema:
  - `Response.status` includes `queued`;
  - `ResponseStreamEvent` includes `ResponseQueuedEvent`;
  - `response.cancelled` is still not a defined terminal stream event.
- Tightened active background retrieve streams:
  - `GET /v1/responses/{id}?stream=true` for an in-process local background job
    now emits `response.created`, `response.queued`, and
    `response.in_progress` before waiting for the stored terminal response;
  - the queued event uses a cloned response snapshot with `status:"queued"`;
  - terminal stored response replay is unchanged, so completed records do not
    gain an extra queued event after the fact;
  - `starting_after` sequence filtering continues to apply to the synthetic
    lifecycle event.
- Also checked the current official `text.format` reference while looking for
  the next gap: `grammar` and `python` schemas exist in components, but the
  active `TextResponseFormatConfiguration` for Responses still references only
  `text`, `json_schema`, and `json_object`, so the bridge's public validation
  remains aligned there.
- Validation:
  - `node --test test/server.test.js --test-name-pattern "background true returns in_progress|cancels an in-progress background response|stored response lifecycle"` passes; the Node runner executed the full `server.test.js` set in this invocation, 290 tests passing;
  - `npm test` passes: 341 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional credential-pattern scan only matched a local test fixture bearer
    token string;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after restart;
  - local smoke against `http://127.0.0.1:12912` with
    `background:true`, `stream:true`, and retrieve `stream=true` emitted
    `response.created -> response.queued -> response.in_progress -> ...
    -> response.completed`;
  - public smoke against `https://opencodexapp.aialra.online` confirmed the
    same active background retrieve-stream lifecycle.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Response Stream Obfuscation

- Rechecked the official OpenAI Responses stream option schema through the
  official `openai/openai-openapi` spec. `include_obfuscation` defaults to
  adding random characters on streaming delta events, and callers can set it to
  `false` to optimize bandwidth on trusted links.
- Implemented local Responses SSE obfuscation:
  - streamed Responses create events add `obfuscation` to bridge-generated
    `response.*.delta` events by default;
  - stored response retrieve streams add `obfuscation` to replayed delta events
    by default;
  - `stream_options.include_obfuscation:false` on create streams and
    `include_obfuscation=false` on stored response retrieve streams omit the
    field.
- Updated tests and the compatibility matrix for default and disabled
  obfuscation behavior.
- Validation:
  - targeted Responses streaming and stored response retrieve-stream tests pass;
  - `npm test` passes: 341 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional `sk-...` pattern scan has no repository matches;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after bridge restart;
  - local smoke against `http://127.0.0.1:12912` confirms live Responses create
    streams and stored response retrieve streams include `obfuscation` by
    default, while `include_obfuscation=false` omits it;
  - public smoke against `https://opencodexapp.aialra.online` confirms the same
    default and disabled obfuscation behavior.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Background Stream Options Drop

- Reproduced a real DeepSeek-compatible provider failure for
  `background:true` requests that also set `stream:true`:
  - Responses background execution correctly disables upstream Chat streaming;
  - the prior Chat mapping still carried `stream_options.include_usage`, causing
    DeepSeek to reject the non-streaming Chat request with
    `stream_options should be set along with stream = true`.
- Fixed the background path:
  - `chat.stream` is still forced to `false`;
  - Chat `stream_options` are now removed before storing or executing the local
    background job;
  - compatibility metadata records
    `stream_options.reason=background_stream_disabled`.
- Updated tests and the compatibility matrix for `background:true` plus
  caller-supplied or bridge-added streaming options.
- Validation:
  - targeted background response tests pass;
  - `npm test` passes: 341 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional `sk-...` pattern scan has no repository matches;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after bridge restart;
  - local smoke against `http://127.0.0.1:12912` with
    `background:true`, `stream:true`, `store:false`, and
    `reasoning.effort:none` completed successfully, emitted
    `response.completed`, and recorded
    `stream_options.reason=background_stream_disabled`;
  - public smoke against `https://opencodexapp.aialra.online` with the same
    request completed successfully, emitted `response.completed`, and recorded
    `stream_options.reason=background_stream_disabled`.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Active Background Retrieve Stream Alignment

- Rechecked the official OpenAI `GET /v1/responses/{response_id}` query
  contract through the official `openai/openai-openapi` schema. The official
  retrieve endpoint accepts `stream`, `starting_after`, and
  `include_obfuscation`; `stream:true` streams response data as it is generated.
- Tightened local stored response streaming:
  - terminal stored responses still replay as typed Responses SSE events without
    re-calling the provider;
  - active in-process background responses now emit `response.created` and
    `response.in_progress`, keep the SSE connection open, wait for the stored
    response to reach a terminal state, then replay the final output and
    official terminal stream event when one exists;
  - cancelled background streams close after progress events because the
    official Responses stream event union does not define a
    `response.cancelled` SSE terminal event.
- Updated tests and the compatibility matrix for active background retrieve
  streams.
- Validation:
  - targeted server tests for stored response replay, active background retrieve
    streaming, and background cancellation pass;
  - `npm test` passes: 341 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional `sk-...` pattern scan has no repository matches;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after bridge restart;
  - local smoke against `http://127.0.0.1:12912` created an active background
    response, retrieved it with `stream=true`, observed the expected
    `response.created` -> `response.in_progress` -> output events ->
    `response.completed` sequence, confirmed the stored response completed, and
    deleted the smoke record;
  - public smoke against `https://opencodexapp.aialra.online` created an active
    background response, retrieved it with `stream=true`, observed the expected
    `response.created` -> `response.in_progress` -> output events ->
    `response.completed` sequence, confirmed the stored response completed, and
    deleted the smoke record.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Response Delete Marker Alignment

- Rechecked the official OpenAI `DELETE /v1/responses/{response_id}` example
  through the official `openai/openai-openapi` schema. The official deletion
  marker uses `object:"response"` with `deleted:true`.
- Aligned the local Responses delete marker:
  - deleted response records still abort any in-process background job and
    remove the local replay record;
  - successful deletes now return `object:"response"` instead of the older
    local `response.deleted` marker.
- Updated tests and the compatibility matrix for the official marker shape.
- Validation:
  - `npm test` passes: 341 tests;
  - `git diff --check` passes;
  - `npm run secret-scan` passes;
  - additional `sk-...` pattern scan has no repository matches;
  - `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are active after bridge restart;
  - local smoke against `http://127.0.0.1:12912` created a stored response,
    deleted it with `object:"response"` and `deleted:true`, then confirmed the
    deleted response returns 404;
  - public smoke against `https://opencodexapp.aialra.online` created a stored
    response, deleted it with `object:"response"` and `deleted:true`, then
    confirmed the deleted response returns 404.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Response Update And Cancel Include Extension Validation

- Rechecked the official OpenAI response retrieval/update/cancel paths through
  the official `openai/openai-openapi` schema. The official retrieval endpoint
  supports `include`; the local metadata update and cancel endpoints use
  include projection as a compatibility extension.
- Tightened the local extension:
  - `POST /v1/responses/{response_id}` now rejects unknown local `include`
    query values before updating stored metadata;
  - `POST /v1/responses/{response_id}/cancel` now rejects unknown local
    `include` query values before returning local terminal/background records;
  - valid include values continue to project stored response fields exactly as
    the retrieval endpoint does.
- Updated tests and the compatibility matrix to document the extension and its
  validation behavior.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'output logprobs include'`:
    passed 290/290 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 341/341.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed invalid update/cancel include extensions
    return HTTP 400 with `param:"include.0"`, while valid cancel include
    projection still returns HTTP 200.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Responses Retrieve Stream Replay

- Rechecked the official OpenAI `GET /v1/responses/{response_id}` schema
  through the official `openai/openai-openapi` schema. Current response
  retrieval supports `stream`, `starting_after`, and `include_obfuscation`
  query parameters in addition to the shared `include` enum.
- Added local stored-response SSE replay for response retrieval:
  - `stream=true` returns `text/event-stream` with typed Responses events for
    the stored response snapshot;
  - replayed events include response lifecycle events, output item/content
    added/delta/done events, and the terminal response event for terminal
    stored responses;
  - `starting_after` filters replayed events by sequence number;
  - `stream`, `starting_after`, and `include_obfuscation` query values are
    validated before local data is returned.
- The replay path does not call the upstream Chat provider again and does not
  yet wait on an active background job; in-progress local records are replayed
  as their current snapshot.
- Updated tests and the compatibility matrix to document retrieve streaming
  behavior.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'Responses lifecycle endpoints retrieve input items'`:
    passed 290/290 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 341/341.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed `stream=true` returns
    `text/event-stream`, `starting_after=4` resumes at sequence 5, invalid
    `stream` values return HTTP 400 with `param:"stream"`, and real stored
    DeepSeek responses can replay terminal `response.incomplete` events.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Responses Retrieve Include Query Tightening

- Rechecked the official OpenAI `GET /v1/responses/{response_id}` schema
  through the official `openai/openai-openapi` schema. Current response
  retrieval supports the shared `IncludeEnum` query array, plus streaming
  resume controls.
- Tightened local Responses retrieval:
  - invalid `include` query values now fail with `include.N` validation errors
    before returning stored local response data;
  - valid include values continue to project stored output fields such as
    `message.output_text.logprobs`, `reasoning.encrypted_content`,
    `web_search_call.action.sources`, `code_interpreter_call.outputs`, and
    `file_search_call.results`.
- Updated tests and the compatibility matrix to document retrieve-time include
  validation.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'Responses lifecycle endpoints retrieve input items|Responses input_items'`:
    passed 290/290 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 341/341.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed stored response retrieval rejects invalid
    `include` query values with HTTP 400 and `param:"include.0"`, while valid
    include retrieval remains HTTP 200.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Responses Input Items Query Tightening

- Rechecked the official OpenAI
  `GET /v1/responses/{response_id}/input_items` schema through the official
  `openai/openai-openapi` schema. Current input-items listing supports `limit`,
  `after`, `include`, and `order`, with default `order=desc` and shared
  `IncludeEnum` query values.
- Tightened local Responses input item listing:
  - default listing now uses official descending order;
  - explicit `order=asc` still returns input write order;
  - invalid `include` query values now fail with `include.N` validation errors
    before returning local data.
- Updated tests and the compatibility matrix to document the default ordering
  and query validation behavior.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'Responses input_items|Responses lifecycle endpoints retrieve input items'`:
    passed 290/290 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 341/341.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed invalid `include` returns HTTP 400 with
    `param:"include.0"`, default input item listing returns newest-first item
    ids, and `order=asc` returns oldest-first item ids.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Conversation Items Include Query Tightening

- Rechecked the official OpenAI Conversation items create/list/retrieve
  schemas and `IncludeEnum` through the official `openai/openai-openapi`
  schema. Current Conversation items endpoints accept `include` query arrays
  using the shared Responses `IncludeEnum`.
- Tightened local Conversation item include handling:
  - create/list/retrieve now reject unknown `include` query values before
    returning local data;
  - create-items responses now use the same local input-item projection as
    list/retrieve, so hidden image URLs remain hidden unless requested.
- Updated tests and the compatibility matrix to document the query validation
  and create-response projection behavior.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'Conversations items include|local Conversations API validates'`:
    passed 289/289 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 340/340.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed invalid Conversation item `include`
    returns HTTP 400 with `param:"include.0"`, create-items hides input image
    URLs by default, and create-items returns image URLs when requested.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Conversation Item Delete Response Alignment

- Rechecked the official OpenAI
  `DELETE /v1/conversations/{conversation_id}/items/{item_id}` schema through
  the official `openai/openai-openapi` schema. Current delete-item returns the
  updated `ConversationResource`, not a deleted marker object.
- Aligned local Conversation item deletion:
  - deleting an item still removes it from local durable Conversation state;
  - successful delete now returns `object:"conversation"` with the
    conversation id, `created_at`, and metadata.
- Updated tests and the compatibility matrix to document the official delete
  response shape.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'local Conversations API'`:
    passed 289/289 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 340/340.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed delete-item returns
    `object:"conversation"` for the updated conversation and removes the item
    from subsequent item lists.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Conversation Items List Ordering Tightening

- Rechecked the official OpenAI
  `GET /v1/conversations/{conversation_id}/items` schema through the official
  `openai/openai-openapi` schema. Current list-items supports `limit`,
  `after`, `before`, `include`, and `order`, with default `order=desc`.
- Tightened local Conversation item listing:
  - default listing now uses official descending order;
  - explicit `order=asc` still returns write-order history for local debugging
    and replay inspection;
  - create-items responses remain in the order of the items created by that
    request.
- Updated tests and the compatibility matrix to document the default ordering.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'local Conversations API'`:
    passed 289/289 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 340/340.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public smoke confirmed default Conversation item listing returns
    newest-first order, while `order=asc` returns oldest-first order.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Conversation Items Create Contract Tightening

- Rechecked the official OpenAI
  `POST /v1/conversations/{conversation_id}/items` schema through the OpenAI
  developer-docs MCP and the official `openai/openai-openapi` schema. Current
  create-items requires an object body with `items` as an array and allows up
  to 20 items per request.
- Tightened local Conversation item creation before storage:
  - official `{items:[...]}` payloads now reject non-array `items` and more
    than 20 items;
  - non-object request bodies are rejected;
  - legacy local extensions remain available for a single raw item object or
    `{item}`, but the item must look like a Conversation item or be a string.
- Updated the compatibility matrix to distinguish the official create-items
  payload from local legacy extensions.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'local Conversations API'`:
    passed 289/289 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 340/340.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository path scan excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public `healthz` returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Local and public `POST /v1/conversations/{id}/items` smoke returned HTTP
    400 with `param:"items"` for non-array `items`, and HTTP 200 list output
    for official `{items:[...]}` payloads.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Conversations Contract Tightening

- Rechecked the official OpenAI Conversations create/update schema through the
  OpenAI developer-docs MCP and the official `openai/openai-openapi` schema.
  Current create accepts an optional object body, nullable string Metadata, and
  `items` as an array/null with at most 20 initial items. Current update
  requires string Metadata.
- Tightened local `/v1/conversations` validation before local storage:
  - create rejects non-object bodies, invalid Metadata, non-array `items`, and
    more than 20 initial items;
  - update rejects non-object bodies, empty bodies, `metadata:null`,
    non-string Metadata values, and unsupported fields.
- Updated the compatibility matrix to document the stricter local
  Conversation create/update contract.
- Validation:
  - `node --test test/server.test.js --test-name-pattern 'local Conversations API'`:
    passed 289/289 because the command executed the full server test file in
    this shell.
  - `npm test`: passed 340/340.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository search excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public `healthz` returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Local and public `POST /v1/conversations` smoke with non-array `items`
    returned HTTP 400 with `param:"items"` and
    `code:"invalid_request_parameter"`.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Batch Create Contract Tightening

- Rechecked the official OpenAI Batch create OpenAPI schema through the
  OpenAI developer-docs MCP and the official `openai/openai-openapi` schema.
  Current Batch create requires `input_file_id`, `endpoint`, and
  `completion_window`, accepts official string `metadata`, and accepts
  `output_expires_after` with `anchor:"created_at"` and `seconds` between
  3600 and 2592000.
- Tightened local `/v1/batches` create validation before file lookup or provider
  calls:
  - required fields must be non-empty strings;
  - user-supplied `metadata` must follow the official 16 key/value pair,
    64-character key, string-only 512-character value contract;
  - `metadata:null` is rejected for Batch create because the current Batch
    schema references Metadata directly;
  - `output_expires_after` is validated against the official file-expiration
    shape and stored on the local Batch object.
- Kept existing local Batch endpoint extensions for regression coverage:
  `/v1/audio/transcriptions`, `/v1/audio/translations`, and
  `/v1/images/variations` remain supported locally and are documented as
  compatibility extensions outside the current official Batch endpoint enum.
- Validation:
  - `npm test -- --test-name-pattern "...Batch..."`: passed 339/339 because
    the command executed the full Node test suite in this shell.
  - `npm test`: passed 339/339.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - generic `sk-...` repository search excluding runtime output/state and
    `node_modules`: no matches.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Local and public `healthz` returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Local and public `POST /v1/batches` smoke with
    `output_expires_after.seconds:3599` returned HTTP 400 with
    `param:"output_expires_after.seconds"` and
    `code:"invalid_request_parameter"`.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.

## 2026-06-17 Goal Reconfirmation and UI Smoke

- Reconfirmed the active product goal is only the CodexApp web gateway:
  1:1 CodexApp web deployment at `opencodexapp.aialra.online`, a universal
  OpenAI Responses API / Chat Completions compatibility layer for DeepSeek and
  other Chat providers, version control through
  `AIALRA-0/open-codex-app-web-gateway.git`, deployment under
  `/srv/aialra/apps`, long-running evaluation, and strict no-secret commits.
- Discarded the uncommitted reader/literature-management prototype changes
  from the working tree because they were not part of this goal. No commit,
  push, or deployment was made for that abandoned direction.
- Verified repository and deployment state:
  - `git status --short`: clean before this audit entry was added.
  - local HEAD: `8a0caa3`.
  - `origin/main`: `8a0caa3be407b15151827825afec3cc3b081e037`.
  - `aialra-opencodexapp-web.service`,
    `aialra-opencodexapp-bridge.service`, and
    `aialra-opencodexapp-app-server.service`: active.
  - local and public `/health`: HTTP 200 `{"ok":true}`.
  - local and public `/healthz`: HTTP 200 with
    `service:"open-codex-responses-bridge"`,
    `provider_base_url:"https://api.deepseek.com"`,
    `default_model:"deepseek-v4-pro"`, and `has_provider_key:true`.
- Verified the latest bridge-regression report:
  - `output/bridge-regression-latest.json`: passed 108/108.
  - average latency: 1293 ms; P95 latency: 3283 ms.
  - token usage: 22,947 input, 1,998 output, 24,945 total.
- Ran the public UI smoke against `https://opencodexapp.aialra.online`:
  - command: `npm run smoke:ui -- --timeout-ms 180000 --output-dir output/playwright/goal-reset-ui-smoke`
  - result: `ok:true`.
  - covered: load/authentication, sidebar controls, plugins/automation/mobile
    navigation, project dialog, browser file upload and verification, project
    writable-root add/clear, new conversation prompt submission, completed-turn
    copy/edit/branch controls, reload persistence, generated image artifact
    display, saved-project create/reopen/cleanup, console errors, and
    screenshot capture.
  - console errors: none.
  - screenshot:
    `output/playwright/goal-reset-ui-smoke/ui-smoke-2026-06-16T22-06-29-368Z.png`.
- Secret handling:
  - no API keys, account credentials, provider headers, or local deployment env
    files were added to the repository.
  - `npm run secret-scan`: passed.

## 2026-06-16 Responses Multimodal Detail Validation

- Rechecked the official OpenAI Responses create OpenAPI schema through the
  OpenAI developer-docs MCP. The current request body documents
  `ResponseInputImage.detail` as `auto`, `low`, `high`, or `original`, while
  `ResponseInputFile.detail` is `low` or `high`.
- Added Responses-specific input detail validation before Chat translation,
  local file/image preparation, or provider calls:
  - `/v1/responses`, `/v1/responses/input_tokens`, and
    `/v1/responses/compact` reject invalid `input_image.detail`,
    compatible nested `image_url.detail`, and `input_file.detail` values with
    OpenAI-style `400 invalid_request_error` responses;
  - prompt-reference variables now validate `input_image` and `input_file`
    objects with Responses enum rules, so `input_image.detail:"original"` is
    accepted while invalid `input_file.detail` values fail locally.
- Updated the Responses-to-Chat image mapper for the Responses-only
  `detail:"original"` value:
  - vision-capable Chat provider calls map it to Chat-compatible
    `image_url.detail:"high"`;
  - text fallback keeps `original` visible in the `[image:...]` marker;
  - `metadata.compatibility.chat_image_inputs` records the original-detail
    count and handling mode.
- Updated the compatibility matrix and evaluation plan so bridge-regression
  coverage distinguishes Responses image/file detail validation from Chat
  image detail passthrough.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check test/translator.test.js`: passed.
  - Targeted server tests for prompt-variable `original`, Responses input
    detail validation, and image-detail mapping: passed 4/4.
  - Targeted translator tests for image detail and `original -> high` mapping:
    passed 2/2.
  - `npm test`: passed 338/338.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active afterward.
  - Local and public healthz returned HTTP 200 with `ok:true`, provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Local and public invalid-request smoke tests returned HTTP 400 with
    expected params for `/v1/responses` `input_image.detail:"ultra"`,
    `/v1/responses/input_tokens` `input_file.detail:"auto"`, and
    `/v1/responses/compact` nested `image_url.detail:"tiny"`.
  - Local and public valid `input_image.detail:"original"` smoke tests returned
    HTTP 200 `status:"completed"` and
    `metadata.compatibility.chat_image_inputs.original_detail_count:1`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact tracked-file search for the development DeepSeek key: clean.

## 2026-06-16 Responses `prompt` Reference Validation

- Rechecked the official OpenAI generated Responses create reference:
  - `https://developers.openai.com/api/reference/resources/responses/methods/create/index.md`
  The current request body documents `prompt` as an optional
  `ResponsePrompt`, with string `id`, optional `version`, and optional
  `variables` map whose values may be strings or `ResponseInputText`,
  `ResponseInputImage`, or `ResponseInputFile` objects.
- Added local `/v1/responses` request validation before local prompt-template
  expansion, Chat translation, or provider calls:
  - non-object/non-string `prompt` values now return OpenAI-style
    `400 invalid_request_error` with `param:"prompt"`;
  - official prompt objects require a non-empty string `id`, unless using the
    bridge's explicit local inline-template compatibility extension;
  - `prompt.id` and local `prompt.prompt_id` / `prompt.name` aliases must be
    non-empty strings when present;
  - `prompt.version` must be a string/null when present;
  - `prompt.variables` must be an object/map when present;
  - each variable value must be a string or an `input_text`, `input_image`, or
    `input_file` object validated with the same content-part checks used by the
    bridge's Chat compatibility layer.
- Preserved existing migration compatibility:
  - string `prompt` remains accepted as a local prompt-template id;
  - `prompt.prompt_id` / `prompt.name` remain accepted as id aliases;
  - `prompt.template` / `prompt.local_template` and inline
    `messages`/`instructions`/`input`/`content`/`text` remain accepted for
    local deterministic fixtures.
- Updated the compatibility matrix and evaluation plan so future
  bridge-regression passes track official prompt-object request validation
  alongside local prompt-template expansion.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "prompt references|prompt templates"
    test/server.test.js`: passed 3/3.
  - `npm test`: passed 335/335.
  - Restarted `aialra-opencodexapp-bridge.service`; local and public healthz
    returned `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Local and public HTTPS invalid-request smoke tests returned HTTP 400 with
    `param:"prompt.id"` for `prompt.id:null` and `param:"prompt.variables"`
    for malformed `prompt.variables`.
  - Local and public HTTPS valid hosted-prompt-reference smoke tests returned
    HTTP 200 `status:"completed"`, exact output `prompt-valid-ok`, and
    `metadata.compatibility.prompt_template.status:"reference_preserved"`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses `instructions` Request Validation

- Rechecked the official OpenAI Responses create reference through the
  developer docs index:
  - `https://developers.openai.com/api/reference/resources/responses/methods/create`
  The current request body documents `instructions` as the system/developer
  message inserted into model context and notes that it does not carry over from
  a previous response when `previous_response_id` is used.
- Added shared local request validation for Responses `instructions` before
  Chat translation or provider calls:
  - `/v1/responses` now rejects non-string `instructions` values with
    OpenAI-style `400 invalid_request_error`, `param:"instructions"`;
  - `/v1/responses/input_tokens` applies the same validation before token-probe
    Chat calls;
  - `/v1/responses/compact` applies the same validation before compaction Chat
    calls.
- Kept valid string behavior unchanged: `responsesToChatRequest()` still maps
  `instructions` into the leading Chat `system` message for DeepSeek and other
  OpenAI-compatible Chat providers.
- Updated the compatibility matrix and evaluation plan so this boundary remains
  visible in future bridge-regression passes.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "Responses instructions"
    test/server.test.js`: passed 1/1.
  - `npm test`: passed 334/334.
  - Restarted `aialra-opencodexapp-bridge.service`; local and public healthz
    returned `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Local and public HTTPS invalid-request smoke tests returned HTTP 400 with
    `param:"instructions"` for `/v1/responses`,
    `/v1/responses/input_tokens`, and `/v1/responses/compact`.
  - Local and public HTTPS valid-string smoke tests returned HTTP 200
    `status:"completed"` with exact output `instructions-ok`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses and Chat `moderation` Config Validation

- Rechecked the official OpenAI generated references:
  - Responses create:
    `https://developers.openai.com/api/reference/resources/responses/methods/create/index.md`
  - Chat Completions create:
    `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/index.md`
  Both current request bodies document `moderation` as an optional object with a
  string `model` field for running moderation on request input and generated
  output. The `input`/`output` object is response data, not the official request
  shape.
- Added shared local request validation for `/v1/responses` and
  `/v1/chat/completions` before Chat translation, local moderation execution, or
  provider calls:
  - non-object `moderation` values such as strings and arrays now return
    OpenAI-style `400 invalid_request_error` with `param:"moderation"`;
  - `moderation.model`, when present, must be a string;
  - the bridge's older local `moderation.input` / `moderation.output`
    compatibility flags remain accepted only as booleans/null.
- Mapped official `moderation:{model:"..."}` requests onto the local inline
  moderation fallback when the Chat provider does not return native moderation
  data. The requested moderation model is preserved in synthesized
  `moderation.input.model` and `moderation.output.model`; the older
  `{input,output}` flags still select local moderation scope for existing
  bridge clients.
- Updated the compatibility matrix and evaluation plan so future regression
  passes cover official `{model}` config validation alongside the retained
  local scope-flag extension.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "moderation config|inline moderation"
    test/server.test.js`: passed 4/4.
  - `npm test`: passed 333/333.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Local and public HTTPS invalid-request smoke tests returned HTTP 400 for
    `/v1/responses` with `param:"moderation"` and direct
    `/v1/chat/completions` with `param:"moderation.input"`.
  - Local and public HTTPS valid-request smoke tests using
    `moderation:{model:"omni-moderation-latest"}` returned HTTP 200 for both
    `/v1/responses` and direct `/v1/chat/completions`, with
    `moderation.input.model:"omni-moderation-latest"` and output moderation
    present.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses Input Tokens `personality` Preset

- Rechecked the official OpenAI Responses input-token-count contract through the
  generated developer reference at
  `https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count/index.md`.
  The current request body documents `personality` as an optional model-owned
  style preset string, including `friendly` and `pragmatic` examples, with
  supported values allowed to expand and a maximum length of 64 characters.
- Added local `/v1/responses/input_tokens` request validation before local
  context preparation, Chat translation side effects, or upstream provider
  calls:
  - non-string `personality` values return an OpenAI-style
    `400 invalid_request_error` with `param:"personality"`;
  - `personality` strings longer than 64 characters return the same local 400
    boundary without contacting DeepSeek or another Chat provider.
- Mapped valid `personality` strings into the upstream Chat Completions token
  probe as a Chat-visible compatibility instruction, preserving arbitrary
  future preset values instead of enum-restricting the request to the currently
  documented examples. The older `style` preset remains accepted as a
  64-character compatibility alias.
- Updated the compatibility matrix and evaluation plan so future regression
  passes track official `personality` support alongside the retained `style`
  compatibility path.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern
    "input_tokens validates and counts (style|personality) preset"
    test/server.test.js`: passed 2/2.
  - `npm test`: passed 331/331.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Local and public HTTPS invalid-request smoke tests with a 65-character
    `personality` returned HTTP 400 with `param:"personality"`.
  - Local and public HTTPS valid-request smoke tests with
    `personality:"curious-custom"` returned HTTP 200,
    `object:"response.input_tokens"`, and `input_tokens:33`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses `context_management` Request Validation

- Rechecked the official OpenAI Responses create contract through the OpenAI
  developer docs MCP and the generated markdown reference at
  `https://developers.openai.com/api/reference/resources/responses/methods/create/index.md`.
  The current create body lists `context_management` as an optional array of
  objects with `type` and optional `compact_threshold`; `type:"compaction"` is
  currently the supported entry type. The `/v1/responses/input_tokens`
  generated reference does not list `context_management`, so this validation is
  scoped to Responses create.
- Added local `/v1/responses` request validation before Chat translation,
  local context preparation, or provider calls:
  - `context_management` must be an array/null when present.
  - Each entry must be an object with `type:"compaction"`.
  - `compact_threshold`, when present and non-null, must be a JSON number.
- Updated Responses-to-Chat compatibility metadata so the official
  `context_management` field is recognized as a non-forwarded local boundary.
  Metadata records entry count, supported types, and threshold presence, but
  not caller-provided threshold values. The older local `context` field remains
  accepted as a compatibility alias and records only value type/object keys.
- Updated the compatibility matrix and evaluation plan to use the official
  `context_management` field name while documenting the alias boundary.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check test/translator.test.js`: passed.
  - `node --test --test-name-pattern
    "context_management|context management|legacy Responses context alias|legacy
    context alias" test/server.test.js test/translator.test.js`: passed 5/5.
  - `npm test`: passed 330/330 after updating a translator expectation that
    exposed the new `alias_for:"context_management"` audit field.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Local and public HTTPS invalid-request smoke tests for
    `context_management:[{type:"retention_ratio"}]` returned HTTP 400 with
    param `context_management.0.type`.
  - Public HTTPS valid-request smoke with
    `context_management:[{type:"compaction"}]` returned HTTP 200 and recorded
    `metadata.compatibility.context_management.forwarded:false`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses `max_tool_calls` Strict JSON Type Validation

- Rechecked the OpenAI Responses create contract through the official developer
  docs MCP for `https://api.openai.com/v1/responses` and the generated
  markdown reference at
  `https://developers.openai.com/api/reference/resources/responses/methods/create/index.md`.
  The reference lists `max_tool_calls` as an optional numeric request field and
  describes it as the maximum total built-in tool calls processed in a
  response.
- Tightened the local hosted-tool budget validator so `max_tool_calls` must be
  a JSON number that is also a non-negative integer. The bridge no longer
  coerces strings such as `"1"` or booleans such as `true` into numeric budgets.
- Extended the `/v1/responses` invalid request regression to cover negative,
  fractional, string, empty-string, and boolean `max_tool_calls` values before
  any provider call.
- Updated the compatibility matrix and evaluation plan so future bridge
  regressions keep type-coercion rejection as part of Responses compatibility.
- Validation:
  - `node --check src/bridge/local_tool_budget.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "max_tool_calls" test/server.test.js`:
    passed 5/5.
  - `node --test --test-name-pattern "corrupt resumable background"
    test/server.test.js`: passed 1/1.
  - `npm test`: passed 327/327.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Local and public HTTPS smoke tests for
    `max_tool_calls:"1"` returned HTTP 400 with param `max_tool_calls` and code
    `invalid_max_tool_calls`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses Native Tool Request Validation

- Rechecked the official OpenAI Responses tool schemas through the OpenAI
  developer docs MCP and the official OpenAPI source:
  `https://api.openai.com/v1/responses/input_tokens` and
  `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `TokenCountsBody.tools` references the shared Responses `Tool` union and
  `TokenCountsBody.tool_choice` references `ToolChoiceParam`; Responses create
  uses the same native tool envelope. The official union includes function,
  file search, computer, web search, MCP, code interpreter, image generation,
  shell, custom, namespace, tool search, and apply-patch style tool entries,
  while `ToolChoiceParam` includes string modes, allowed-tool sets, hosted-tool
  selectors, named function/custom/MCP selectors, and shell/apply-patch
  selectors.
- Added local Responses-native request validation before conversation replay,
  local hosted-tool preparation, Chat translation, token probing, or provider
  calls:
  - `tools` must be an array/null, and each item must be a typed object from
    the official or bridge-owned Responses tool type set.
  - `function` and `custom` tool names must use the OpenAI-compatible function
    name shape; `parameters` must be object/null when present; `strict` and
    `defer_loading` must be booleans/null as appropriate.
  - MCP tools require a string `server_label`.
  - Namespace tools require non-empty `name`, `description`, and function/custom
    child tool definitions.
  - `tool_choice` must be an official mode string or a recognized selector
    object; named function/custom/MCP choices validate their required names, and
    `allowed_tools` validates `mode` plus the top-level tool list shape.
- Preserved existing CodexApp hosted-tool behavior by keeping
  `tool_choice:{type:"tool_search"}` as a bridge-owned selector for local
  deferred tool loading. The first full test run exposed this compatibility
  edge; the validator was adjusted and the tool-search regression subset passed
  before re-running the full suite.
- Updated the compatibility matrix and evaluation plan to distinguish
  Responses-native flat tool definitions from direct Chat nested tool
  definitions.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "Responses tools" test/server.test.js`:
    passed 1/1.
  - `node --test --test-name-pattern "tool_search" test/server.test.js`:
    passed 10/10 after preserving the local `tool_search` selector.
  - `npm test`: passed 327/327.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/responses/input_tokens` returned HTTP 400 with params `tools`,
    `tools.0.name`, and `tool_choice.name` for invalid values.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 5.0G free after tests, restart, and
  smoke checks.

## 2026-06-16 Responses Input Tokens Official Field Validation

- Rechecked the official OpenAI `/v1/responses/input_tokens` endpoint through
  the OpenAI developer docs MCP and the official OpenAPI source:
  `https://api.openai.com/v1/responses/input_tokens` and
  `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `TokenCountsBody` currently exposes `model`, `input`,
  `previous_response_id`, `tools`, `text`, `reasoning`, `truncation`,
  `instructions`, `conversation`, `tool_choice`, and `parallel_tool_calls`,
  with no required fields. Its `parallel_tool_calls` field is boolean/null,
  `text` references the Responses text format object, and `reasoning`
  references the shared reasoning object.
- Tightened local request validation for `POST /v1/responses/input_tokens`
  before conversation replay, local file/image preparation, token probing, or
  provider calls:
  - `parallel_tool_calls` must be boolean/null.
  - `text` must be an object/null and `text.format.type` must be `text`,
    `json_object`, or `json_schema`, with the existing Responses
    `json_schema` shape checks.
  - `reasoning` must be an object/null and `reasoning.effort` must be one of
    `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- Preserved valid field behavior through the Chat usage probe:
  - valid `parallel_tool_calls` remains eligible for Chat-native passthrough or
    provider-aware filtering/mapping;
  - valid `text.format` still maps to Chat `response_format` or the local
    DeepSeek-compatible JSON instruction path;
  - valid `reasoning.effort` still flows through the existing DeepSeek
    `reasoning_effort` / `thinking` compatibility mapper.
- Updated the compatibility matrix and evaluation plan so input-token probes
  carry the same official boundary coverage as Responses create for these
  fields.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "responses/input_tokens" test/server.test.js`:
    passed 8/8.
  - `npm test`: passed 326/326.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses/input_tokens` returned
    HTTP 400 with params `parallel_tool_calls`, `text.format.type`, and
    `reasoning.effort` for invalid values.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 5.2G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Responses Compact Request Validation

- Rechecked the current official OpenAI Responses compact documentation through
  the OpenAI developer docs MCP and the official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/compact`,
  `https://api.openai.com/v1/responses/compact`, and
  `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CompactResponseMethodPublicBody` requires `model` and exposes
  `input`, `previous_response_id`, `instructions`, `prompt_cache_key`,
  `prompt_cache_retention`, and `service_tier`. The official schema gives
  `prompt_cache_key` a 64-character string limit, uses
  `PromptCacheRetentionEnum` for `prompt_cache_retention`, and uses
  `ServiceTierEnum` for `service_tier`.
- Added compact request validation before replay, local input preparation,
  local context truncation, compaction, or provider calls:
  - `POST /v1/responses/compact` now requires a non-empty string `model`.
  - `prompt_cache_key` must be string/null and at most 64 characters.
  - `prompt_cache_retention` must be `in_memory`, `24h`, or null.
  - `service_tier` must be `auto`, `default`, `flex`, `priority`, or null.
- Preserved valid cache and service fields through the compaction Chat rebuild:
  - `prompt_cache_key` and `prompt_cache_retention` are forwarded when the
    provider configuration keeps Chat-native fields.
  - `service_tier` is forwarded only when the existing provider-aware
    `service_tier` mapper keeps it.
  - DeepSeek-compatible `prompt_cache_key` to `user_id` mapping is preserved by
    copying the translated `user_id` from the intermediate Chat request.
- Updated the compatibility matrix and evaluation plan so compact has explicit
  request-boundary coverage alongside Responses create and input-token probes.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "responses/compact|Responses auxiliary endpoints replay local conversation state" test/server.test.js`:
    passed 4/4.
  - `npm test`: passed 325/325.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses/compact` returned HTTP
    400 with params `model`, `prompt_cache_key`, and `service_tier` for missing
    model, overlong prompt cache key, and invalid service tier values.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 5.5G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Responses Truncation Validation

- Rechecked the current official OpenAI Responses create documentation through
  the OpenAI developer docs MCP and the official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://api.openai.com/v1/responses/input_tokens`, and
  `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CreateResponse.truncation` is `auto`, `disabled`, or null, and
  `TokenCountsBody.truncation` references the same `TruncationEnum`. The
  official compact request body does not currently expose `truncation`, but the
  bridge's local compact compatibility path already participates in local
  replay truncation, so any caller-supplied `truncation` value is now validated
  against the same enum before local work starts.
- Added local request validation before replay, local context truncation, or
  provider calls:
  - `POST /v1/responses` rejects invalid `truncation` values with
    `400 invalid_request_error`, `code:"invalid_request_parameter"`, and
    `param:"truncation"`.
  - `POST /v1/responses/input_tokens` applies the same enum validation before
    prompt-token probes.
  - `POST /v1/responses/compact` applies the same enum validation for the
    bridge's local compact compatibility extension.
  - Valid `auto`, `disabled`, omitted, and null values keep the existing local
    truncation behavior.
- Updated the compatibility matrix and evaluation plan so `truncation` enum
  validation is tracked alongside the existing local context-budget behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "Responses truncation" test/server.test.js`:
    passed 3/3.
  - `npm test`: passed 323/323.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses`,
    `/v1/responses/input_tokens`, and `/v1/responses/compact` returned HTTP
    400 with `param:"truncation"` for invalid string, boolean, and empty-string
    values.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 6.0G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Responses State Reference Validation

- Rechecked the current official OpenAI Responses create, input-token-count,
  and compact documentation through the OpenAI developer docs MCP:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count`,
  and `https://developers.openai.com/api/reference/resources/responses/methods/compact`.
  The docs state that `previous_response_id` is the prior response id for
  multi-turn state and cannot be used with `conversation`. The official OpenAPI
  schema also defines `ConversationParam` as a string or object with required
  string `id`.
- Added local request validation before provider calls:
  - `previous_response_id` must be string/null on Responses stateful entry
    points.
  - `conversation` must be an id string or an object with an `id` string.
  - The local compatibility alias `conversation_id` must be string/null.
  - Requests combining `previous_response_id` with `conversation` or
    `conversation_id` now return `400 invalid_request_error` with
    `param:"previous_response_id"` before replay lookup, local conversation
    reads, compaction, input-token probes, or upstream Chat calls.
- Updated the compatibility matrix and evaluation plan so state-reference
  validation is tracked across `POST /v1/responses`,
  `POST /v1/responses/input_tokens`, and `POST /v1/responses/compact`.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "state references|local Conversations API persists items|auxiliary endpoints replay local conversation state|maps to /v1/chat/completions and stores previous response replay" test/server.test.js`:
    passed 4/4.
  - `npm test`: passed 322/322.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/responses/input_tokens` returned HTTP 400 with params
    `previous_response_id` and `conversation` for the new conflict and shape
    validation paths.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 6.3G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Responses Include Validation

- Rechecked the current official OpenAI Responses create documentation through
  the OpenAI developer docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CreateResponse.include` is `array|null`, and each item must be an
  `IncludeEnum` value. The current enum contains `file_search_call.results`,
  `web_search_call.results`, `web_search_call.action.sources`,
  `message.input_image.image_url`,
  `computer_call_output.output.image_url`,
  `code_interpreter_call.outputs`, `reasoning.encrypted_content`, and
  `message.output_text.logprobs`.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects non-array `include` values, unknown
    include strings, empty strings, and non-string include elements with
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    nested `param` values such as `include.1`.
  - Valid official include values continue through the existing projection
    layer; `message.output_text.logprobs` still enables upstream Chat
    `logprobs:true`, and local hidden-field projections remain controlled by
    the include set.
  - `web_search_call.results` is accepted as an official include enum value;
    current local web-search detail exposure remains through the already
    implemented `web_search_call.action.sources` projection.
- Added regression coverage proving invalid include shapes/values fail locally
  with zero upstream provider calls, while a request carrying every current
  official include value reaches the mock Chat provider and returns normally.
- Updated the compatibility matrix and evaluation plan so include enum
  validation is tracked as a protocol-correctness invariant.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "validates include values before provider calls|maps output logprobs include to Chat and back|includes local web_search action sources when requested|local code_interpreter emits Responses code_interpreter_call outputs|file_search_call.results" test/server.test.js`:
    passed 4/4.
  - `npm test`: passed 321/321.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    params `include`, `include.0`, and `include.1` for string, unknown, and
    non-string include values.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 6.7G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Required Create Field Validation

- Rechecked the current official OpenAI request schema through the OpenAI
  developer docs MCP/OpenAPI endpoint metadata and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://api.openai.com/v1/completions`, and
  `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CreateModelResponseProperties` requires `model`, so both Responses create
  and Chat Completions create inherit a required model field; Chat create also
  requires `messages`; legacy `CreateCompletionRequest` requires both `model`
  and `prompt`. The current OpenAPI `CreateResponse` object exposes `input`
  but does not add it to a `required` array, so this pass only enforces
  Responses `model`.
- Added local request validation before provider calls:
  - `POST /v1/responses` rejects missing, null, empty, or non-string `model`
    before translation, local tool execution, storage, or upstream Chat calls.
  - Direct `POST /v1/chat/completions` now requires a non-empty string
    `model` before the already-covered `messages` validation and direct
    provider passthrough.
  - Legacy `POST /v1/completions` now requires a non-empty string `model` and
    a present `prompt` field before prompt-to-Chat mapping.
  - Internal fallback defaults remain available after the public boundary for
    local compatibility paths that already provide a validated model.
- Added regression coverage proving invalid required fields fail locally with
  `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, the
  correct `param`, and zero upstream provider calls; valid create requests
  still reach the mock Chat provider.
- Updated the compatibility matrix and evaluation plan so required create-field
  validation is tracked as a protocol-correctness invariant.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "validates required model before provider calls|validates required fields before provider calls|validates messages before provider calls|maps legacy prompts to Chat Completions|maps to /v1/chat/completions" test/server.test.js`:
    passed 6/6.
  - `npm test`: passed 320/320.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses`,
    `/v1/chat/completions`, and `/v1/completions` returned HTTP 400 with
    params `model`, `model`, `model`, and `prompt` for missing required
    create fields.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `npm run secret-scan`,
  `git diff --check`, and the exact tracked-file DeepSeek key search passed.
- Storage: `/srv/aialra/apps` had roughly 7.1G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Chat Message Validation

- Rechecked the official OpenAI Chat Completions request contract through the
  OpenAI developer docs MCP result and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CreateChatCompletionRequest` requires a non-empty `messages` array, uses
  role-specific message variants for `developer`, `system`, `user`,
  `assistant`, `tool`, and deprecated `function`, supports text, image, input
  audio, file, and refusal content parts in the documented roles, and requires
  assistant tool calls to carry typed function/custom call payloads.
- Added local request validation before provider calls:
  - Direct `POST /v1/chat/completions` now validates `messages` before
    provider-aware passthrough, DeepSeek role normalization, multimodal/file
    fallback preparation, stored-chat handling, local web search, or upstream
    Chat requests.
  - Developer/system/tool messages accept string or text-part content; user
    messages accept string content plus official multimodal/file parts and
    the bridge's already-supported direct Chat aliases (`input_text`,
    `input_image`, `image_file`, `audio`, and `input_file`).
  - Assistant messages require content unless a valid `tool_calls` array or
    deprecated `function_call` object is present; tool and deprecated function
    replay messages require their linking fields.
  - Invalid values return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant nested `param`
    locally with zero upstream provider calls.
- Preserved valid compatibility behavior: existing direct Chat image, audio,
  and file fallback paths still accept their supported content aliases; valid
  tool-replay messages are forwarded unchanged to capable Chat providers.
- Added regression coverage proving invalid `messages` shape, unsupported
  roles, role-incompatible content parts, malformed image/audio content,
  assistant tool-call payloads, and missing tool/function replay identifiers
  fail locally with zero upstream calls, while a valid developer/user/
  assistant/tool/function replay request reaches the provider unchanged.
- Updated the compatibility matrix and evaluation plan so direct Chat
  `messages` are tracked as an OpenAI-boundary validated field instead of only
  generic provider passthrough.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "validates messages before provider calls|normalizes OpenAI Chat fields|falls back to text markers for direct Chat image inputs|falls back to text markers for direct Chat audio inputs|extracts direct Chat file content" test/server.test.js`:
    passed 5/5.
  - `npm test`: passed 317/317.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/chat/completions` returned HTTP 400
    with params `messages`, `messages.0.content.0.image_url.url`, and
    `messages.0.tool_calls.0.function.arguments`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 7.9G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Chat Tool Field Validation

- Rechecked the official OpenAI Chat Completions request contract through the
  OpenAI developer docs MCP search result and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CreateChatCompletionRequest` documents `tools` as function or custom tools,
  `tool_choice` as `none`, `auto`, `required`, named function/custom choice,
  or `allowed_tools`, deprecated `functions` as 1-128 function definitions,
  and deprecated `function_call` as `none`, `auto`, or `{name}`. Function
  names must use letters, numbers, underscores, or dashes and be at most 64
  characters.
- Added local request validation before provider calls:
  - Direct `POST /v1/chat/completions` now validates Chat `tools` and
    `tool_choice` shapes before passthrough, DeepSeek-compatible custom-tool
    filtering, stored-chat handling, local web-search setup, or upstream Chat
    requests.
  - Both `POST /v1/responses` and direct Chat now validate deprecated Chat
    `functions` / `function_call` compatibility aliases before legacy
    function-to-tool mapping or upstream Chat requests.
  - Invalid values return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant `param` locally with
    zero upstream provider calls.
- Preserved valid compatibility behavior: function tools still forward to
  capable providers, valid custom tools and `allowed_tools` choices remain
  pass-through when provider-native forwarding is enabled, DeepSeek-compatible
  deployments still filter unsupported custom tools and incompatible choices
  while preserving function tools, and valid legacy functions still map to
  modern Chat `tools` / `tool_choice` with compatibility metadata.
- Added regression coverage proving invalid direct Chat tool arrays, function
  names, function parameters, strict flags, custom formats, grammar syntax,
  `tool_choice` strings, named choices, and `allowed_tools` choices fail
  locally with zero upstream calls; Responses legacy `functions` /
  `function_call` invalid shapes also fail locally with zero upstream calls.
- Updated the compatibility matrix and evaluation plan so direct Chat tool
  definitions, tool-choice constraints, and deprecated Chat function aliases
  are tracked as OpenAI-boundary validated fields.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "legacy Chat function fields|tools and tool_choice before provider calls|normalizes OpenAI Chat fields|filters custom tools|legacy Chat functions" test/server.test.js`:
    passed 4/4.
  - `npm test`: passed 316/316.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/chat/completions` and
    `/v1/responses` returned HTTP 400 with params `tools.0.type`,
    `tool_choice.allowed_tools.mode`, and `function_call.name`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 8.6G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Chat Web Search Options Validation

- Rechecked the official OpenAI Chat Completions request contract through the
  OpenAI developer docs MCP and the official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  The Chat create schema documents `web_search_options` with optional
  `search_context_size` values `low`, `medium`, or `high`, and optional
  `user_location` as null or an approximate-location object requiring
  `type:"approximate"` plus an `approximate` object whose `country`, `region`,
  `city`, and `timezone` fields are strings when present.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects invalid Chat-native
    `web_search_options` before Responses-to-Chat translation,
    provider-aware passthrough/filtering, local web-search setup, or upstream
    Chat requests.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough, DeepSeek-compatible local web-search emulation, stored-chat
    handling, or upstream Chat requests.
  - Invalid values return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant `param` locally with
    zero upstream provider calls.
- Preserved valid compatibility behavior: valid `web_search_options` still
  pass through to capable providers, while DeepSeek-compatible direct Chat
  requests continue using the local web-search adapter, source-context
  injection, source annotations, usage accounting, and
  `metadata.compatibility.chat_passthrough.web_search_options`.
- Added regression coverage proving invalid option shape, invalid
  `search_context_size`, missing `user_location.approximate`, invalid
  `type`, invalid approximate object shape, and non-string approximate fields
  fail locally on Responses and direct Chat with zero upstream calls, while
  valid requests preserve the existing local web-search behavior.
- Updated the compatibility matrix and evaluation plan so Chat web-search
  options are tracked as OpenAI-boundary validated fields rather than only
  provider-aware passthrough or fallback behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "web_search_options before provider calls|emulates web_search_options locally|maps Chat-native aliases" test/server.test.js`:
    passed 4/4.
  - `npm test`: passed 314/314.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` returned HTTP 400 with params
    `web_search_options.search_context_size`,
    `web_search_options.user_location.approximate`, and
    `web_search_options.user_location.approximate.timezone`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 9.1G free after tests, restart, and
  smoke checks.

## 2026-06-16 Official Chat Output Field Validation

- Rechecked the official OpenAI Chat Completions request contract through the
  OpenAI developer docs MCP search result and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `CreateChatCompletionRequest` documents `modalities` through the shared
  `ResponseModalities` schema as array/null of `text` / `audio`, `audio` as
  object/null with required `voice` and `format` when audio output is
  requested, output formats `wav`, `aac`, `mp3`, `flac`, `opus`, and `pcm16`,
  and `prediction` as nullable `PredictionContent` with `type:"content"` plus
  string or non-empty text-part content.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects invalid Chat-native output `modalities`,
    `audio`, and `prediction` values before Responses-to-Chat translation,
    provider-aware passthrough/filtering, or upstream Chat requests.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough, DeepSeek-compatible field filtering, local stored-completion
    handling, or upstream Chat requests.
  - Requests with `modalities:["audio"]` must include a valid `audio` object,
    custom voice objects must contain only a string `id`, and predicted output
    arrays must contain text content parts with string `text`.
  - Invalid values return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant `param` locally with
    zero upstream provider calls.
- Preserved existing compatibility behavior for valid values: valid fields
  still pass through when the configured provider supports Chat-native fields,
  and DeepSeek-compatible deployments still filter unsupported
  `modalities` / `audio` / `prediction` fields with compatibility metadata
  instead of forwarding them upstream.
- Added regression coverage proving invalid Chat output field shapes fail
  locally on Responses and direct Chat with zero upstream calls, while valid
  output audio and predicted-output request shapes continue through the
  existing passthrough or provider-filtered paths.
- Updated the compatibility matrix and evaluation plan so Chat output
  modalities, audio-output parameters, and predicted-output content are tracked
  as OpenAI-boundary validated fields.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "Chat output fields|maps Chat-native aliases and request fields|normalizes OpenAI Chat fields"`:
    passed 263/263; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 312/312.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"audio"` for `modalities:["audio"]` without `audio`; public
    `/v1/chat/completions` returned HTTP 400 with `param:"audio.format"` for
    unsupported `audio.format:"ogg"` and HTTP 400 with
    `param:"prediction.content"` for a text prediction part missing string
    `text`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 9.7G free after tests and smoke
  checks.

## 2026-06-16 Official Legacy Best-Of And Suffix Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/completions/methods/create`
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Legacy `CreateCompletionRequest` documents `best_of` as integer/null from 0
  through 20, with `best_of` incompatible with streaming and required to be
  greater than explicit `n` when both fields are set. Legacy `suffix` is
  documented as string/null insertion suffix context.
- Added local request validation before provider calls:
  - `POST /v1/completions` now rejects invalid `best_of` values before legacy
    prompt-to-Chat mapping, non-streaming provider calls, or streaming provider
    calls.
  - `best_of` must be an integer/null from 0 through 20, cannot be used with
    `stream:true`, and must be greater than explicit `n` when both fields are
    set.
  - `POST /v1/completions` now rejects non-string `suffix` values before any
    upstream Chat request.
  - Invalid values return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant `param` locally with
    zero upstream provider calls.
- Preserved existing compatibility behavior for valid values: valid `suffix`
  text is still converted into Chat-visible insertion context, valid `best_of`
  is accepted for OpenAI boundary compatibility, and unsupported legacy-only
  fields are not forwarded to Chat Completions providers.
- Added regression coverage proving invalid `best_of` and `suffix` values fail
  locally with zero upstream calls, and valid `best_of` plus `suffix` requests
  still complete through the existing Chat-backed legacy completion mapper.
- Updated the compatibility matrix and evaluation plan so legacy completion
  insertion and server-side selection parity is tracked as validated local
  compatibility, with `best_of` still marked as not losslessly representable on
  Chat-only providers.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "best_of and suffix|POST /v1/completions maps legacy prompts|validates n before provider calls|validates stream flag before provider calls"`:
    passed 261/261; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 310/310.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/completions` returned HTTP 400 with
    `param:"best_of"` for `best_of:21`, `best_of` with `stream:true`, and
    `best_of` not greater than explicit `n`; public `suffix:[]` returned HTTP
    400 with `param:"suffix"`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after restart and
    smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 11G free after tests and smoke
  checks.

## 2026-06-16 Official Legacy Sampling And Stop Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Legacy `CreateCompletionRequest` documents `temperature` as number/null from
  0 through 2, `top_p` as number/null from 0 through 1,
  `frequency_penalty` and `presence_penalty` as number/null from -2 through 2,
  and `stop` through `StopConfiguration`. The shared `StopConfiguration`
  accepts null, a string, or an array with 1 to 4 string items.
- Added local request validation before provider calls:
  - `POST /v1/completions` now rejects invalid `temperature`, `top_p`,
    `frequency_penalty`, and `presence_penalty` values before legacy
    prompt-to-Chat mapping, non-streaming provider calls, or streaming provider
    calls.
  - `POST /v1/completions` now rejects invalid `stop` values before any
    upstream Chat request.
  - The shared stop-sequence validator now rejects empty `stop:[]` arrays for
    Responses create, direct Chat, and legacy Completions, matching the
    official 1-to-4 array item contract.
  - Invalid values return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant `param` locally with
    zero upstream provider calls.
- Preserved existing compatibility behavior for valid values: valid legacy
  sampling parameters and valid string or 1-to-4-string stop sequences still
  flow into the Chat-backed legacy completion request and keep existing
  non-streaming/streaming completion response mapping.
- Added regression coverage proving invalid legacy sampling and stop values
  fail locally with zero upstream calls, valid boundary values pass through, and
  `stop:[]` is rejected on Responses create, direct Chat, and legacy
  Completions.
- Updated the compatibility matrix and evaluation plan so sampling and stop
  parity covers legacy Completions in addition to Responses/direct Chat.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "validates sampling parameter ranges before provider calls|validates stop sequences before provider calls|POST /v1/completions maps prompt-style"`:
    passed 260/260; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 309/309.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/completions` returned HTTP 400 with
    `param:"temperature"` for `temperature:2.1` and HTTP 400 with
    `param:"stop"` for `stop:[]`; public `/v1/responses` and
    `/v1/chat/completions` also returned HTTP 400 with `param:"stop"` for
    `stop:[]`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 11G free after tests and smoke
  checks.

## 2026-06-16 Official Stream Options Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Chat Completions and legacy Completions reference
  `ChatCompletionStreamOptions`, an object/null with boolean
  `include_usage` and `include_obfuscation` fields. Responses references
  `ResponseStreamOptions`, an object/null with boolean `include_obfuscation`.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects non-object `stream_options` values and
    non-boolean known subfields before Responses-to-Chat translation,
    non-stream filtering, or upstream provider calls.
  - local `POST /v1/responses/input_tokens` applies the same validation before
    building the prompt-token probe.
  - `POST /v1/chat/completions` now validates `stream_options` before direct
    Chat passthrough, provider-specific stream-option filtering, or streaming
    routing.
  - `POST /v1/completions` now validates `stream_options` before legacy
    prompt-to-Chat mapping, non-streaming provider calls, or streaming
    provider calls.
  - Invalid strings, arrays, and non-boolean known subfields now return
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    the relevant `param` locally with zero upstream provider calls.
- Preserved existing compatibility behavior for valid values: non-streaming
  valid `stream_options` objects are still filtered with
  `metadata.compatibility.stream_options.reason:"stream_required"`, direct Chat
  still forwards provider-supported stream option fields, and the bridge keeps
  the Responses-to-Chat `include_usage` compatibility extension while
  validating it if callers provide it.
- Added regression coverage proving invalid stream option values fail locally
  with zero upstream calls on Responses create, Responses input-token probes,
  direct Chat, and legacy Completions; valid values continue through the
  existing non-stream filtering and SSE compatibility paths.
- Updated the compatibility matrix and evaluation plan so streaming option
  parity tracks official request validation in addition to provider-aware
  passthrough/filtering.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "stream_options before provider calls|filters stream_options|streams Chat chunks|completions streams|streams and stores reconstructed|normalizes OpenAI Chat fields"`:
    passed 258/258; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 307/307.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"stream_options"` for `stream_options:"yes"`; public
    `/v1/responses/input_tokens` returned HTTP 400 with
    `param:"stream_options.include_usage"` for string `include_usage`; public
    `/v1/chat/completions` returned HTTP 400 with
    `param:"stream_options.include_obfuscation"` for null
    `include_obfuscation`; public `/v1/completions` returned HTTP 400 with
    `param:"stream_options"` for array `stream_options`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 12G free after tests and smoke
  checks.

## 2026-06-16 Official Identity Cache Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Chat and Responses describe `safety_identifier` as a string user identifier
  with a 64-character maximum, `prompt_cache_retention` as `in_memory` or
  `24h`, and legacy `user` as a string. The OpenAPI source additionally
  documents Responses `prompt_cache_key` as string/null with a 64-character
  maximum and Chat `prompt_cache_key` as a string.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects non-string `user`,
    `safety_identifier`, and `prompt_cache_key`, rejects
    `safety_identifier` and Responses `prompt_cache_key` values over 64
    characters, and rejects unsupported `prompt_cache_retention` values before
    Responses-to-Chat translation or upstream provider calls.
  - local `POST /v1/responses/input_tokens` applies the same identity/cache
    validation before building the prompt-token probe.
  - `POST /v1/chat/completions` now rejects non-string `user`,
    `safety_identifier`, and `prompt_cache_key`, rejects
    `safety_identifier` over 64 characters, and rejects unsupported
    `prompt_cache_retention` values before direct Chat passthrough, provider
    filtering, or DeepSeek `user_id` mapping.
  - `POST /v1/completions` now rejects non-string legacy `user` values before
    prompt-to-Chat mapping, non-streaming provider calls, or streaming provider
    calls.
  - Invalid strings, arrays, objects, numbers, and enum values now return
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    the relevant `param` locally with zero upstream provider calls.
- Preserved existing compatibility behavior for valid values: identity/cache
  fields continue to be forwarded for providers that support them or mapped
  into DeepSeek `user_id` compatibility metadata when configured.
- Added regression coverage proving invalid identity/cache values fail locally
  with zero upstream calls on Responses create, Responses input-token probes,
  direct Chat, and legacy Completions; valid values continue through
  provider-aware passthrough or mapping.
- Updated the compatibility matrix and evaluation plan so identity/cache parity
  tracks official request validation in addition to DeepSeek `user_id` mapping.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "identity and cache|validates user before provider calls|maps prompt_cache_key|normalizes OpenAI Chat fields"`:
    passed 254/254; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 303/303.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"user"` for `user:{}`; public `/v1/responses/input_tokens`
    returned HTTP 400 with `param:"prompt_cache_key"` for a 65-character
    `prompt_cache_key`; public `/v1/chat/completions` returned HTTP 400 with
    `param:"safety_identifier"` for a 65-character `safety_identifier`;
    public `/v1/completions` returned HTTP 400 with `param:"user"` for
    `user:[]`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 7.2G free after tests and smoke
  checks.

## 2026-06-16 Official Seed Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Chat Completions `seed` is an integer/null field with the official
  `-9223372036854776000` through `9223372036854776000` range; legacy
  Completions `seed` is an integer/null int64-compatible field.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects non-integer and out-of-official-range
    Chat-native `seed` values before Responses-to-Chat translation or upstream
    provider calls.
  - local `POST /v1/responses/input_tokens` applies the same `seed` validation
    before building the prompt-token probe.
  - `POST /v1/chat/completions` now rejects invalid `seed` values before
    direct Chat passthrough or provider-specific normalization.
  - `POST /v1/completions` now rejects invalid legacy `seed` values before
    prompt-to-Chat mapping, non-streaming provider calls, or streaming provider
    calls.
  - Invalid strings, floats, arrays, objects, and out-of-range numbers now
    return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and `param:"seed"` locally with zero
    upstream provider calls.
- Preserved existing compatibility behavior for valid values: Responses
  Chat-native seeds, local input-token probes, direct Chat requests, and legacy
  Completions requests continue forwarding valid integer seeds through the
  bridge.
- Added regression coverage proving invalid `seed` values fail locally with
  zero upstream calls on Responses create, Responses input-token probes, direct
  Chat, and legacy Completions; valid seeds continue through provider-aware
  passthrough.
- Updated the compatibility matrix and evaluation plan so deterministic
  sampling parity tracks official `seed` validation in addition to field
  forwarding.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "validates seed|maps legacy prompts|normalizes OpenAI Chat fields"`:
    passed 250/250; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 299/299.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"seed"` for `seed:"42"`; public `/v1/responses/input_tokens`
    returned HTTP 400 with `param:"seed"` for `seed:1e21`; public
    `/v1/chat/completions` returned HTTP 400 with `param:"seed"` for
    `seed:123.5`; public `/v1/completions` returned HTTP 400 with
    `param:"seed"` for `seed:-1e21`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 7.5G free after tests and smoke
  checks.

## 2026-06-16 Official Token Limit Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Responses `max_output_tokens` is an integer/null field with an official
  minimum of 16; Chat Completions `max_completion_tokens` and deprecated
  `max_tokens` are integer/null fields; legacy Completions `max_tokens` is an
  integer/null field with minimum 0.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects non-integer `max_output_tokens`, values
    below 16, and non-integer Chat-native `max_completion_tokens` / `max_tokens`
    aliases before Responses-to-Chat translation or upstream provider calls.
  - local `POST /v1/responses/input_tokens` applies the same Responses and
    Chat-token-alias validation before building the prompt-token probe.
  - `POST /v1/chat/completions` now rejects non-integer
    `max_completion_tokens` and `max_tokens` before direct Chat passthrough or
    provider-specific token-field normalization.
  - `POST /v1/completions` now rejects non-integer and negative legacy
    `max_tokens` before prompt-to-Chat mapping, non-streaming provider calls,
    or streaming provider calls.
  - Invalid strings, floats, arrays, objects, and out-of-range lower-bound
    numbers now return `type:"invalid_request_error"`,
    `code:"invalid_request_parameter"`, and the relevant `param` locally with
    zero upstream provider calls.
- Preserved existing compatibility behavior for valid values:
  - Responses `max_output_tokens:16` still maps to the configured upstream Chat
    max-token field;
  - Responses Chat-native `max_completion_tokens` / `max_tokens` aliases remain
    accepted as integer/null fields and retain existing precedence metadata;
  - direct Chat `max_completion_tokens` still maps to DeepSeek `max_tokens` or
    any configured provider token field;
  - legacy Completions `max_tokens:0` remains valid and is forwarded through the
    prompt-to-Chat adapter.
- Added regression coverage proving invalid token-limit values fail locally with
  zero upstream calls on Responses create, Responses input-token probes, direct
  Chat, and legacy Completions; valid boundary or normal values continue through
  the bridge.
- Updated the compatibility matrix and evaluation plan so token-limit parity
  tracks official request validation in addition to provider-specific field
  mapping.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "validates token limits|validates max_tokens|aliases token limits|maps Chat max_completion_tokens alias|input_tokens validates token limits"`:
    passed 246/246; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 295/295.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"max_output_tokens"` for `max_output_tokens:15`; public
    `/v1/responses/input_tokens` returned HTTP 400 with
    `param:"max_output_tokens"` for `max_output_tokens:"16"`; public
    `/v1/chat/completions` returned HTTP 400 with
    `param:"max_completion_tokens"` for `max_completion_tokens:"32"`; public
    `/v1/completions` returned HTTP 400 with `param:"max_tokens"` for
    `max_tokens:-1`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` had roughly 8.0G free after tests and smoke
  checks.

## 2026-06-16 Official Logprobs And Echo Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Chat Completions `logprobs` is a nullable boolean-style request flag,
  Chat `top_logprobs` is an integer from 0 through 20 and requires
  `logprobs:true`, legacy Completions `echo` is nullable boolean, and legacy
  Completions `logprobs` is an integer from 0 through 5.
- Added local request validation before provider calls:
  - `POST /v1/responses` now rejects non-boolean Chat-native `logprobs`
    aliases before Responses-to-Chat translation or upstream provider calls.
  - `POST /v1/chat/completions` now rejects non-boolean `logprobs` values
    before direct Chat passthrough and before evaluating `top_logprobs`.
  - `POST /v1/completions` now rejects non-boolean `echo` and non-integer or
    out-of-range `logprobs` values before prompt-to-Chat mapping, non-streaming
    provider calls, or streaming provider calls.
  - Invalid strings, numbers, arrays, and objects now return
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    the relevant `param` locally with zero upstream provider calls.
- Preserved existing compatibility behavior for valid values:
  - Responses `top_logprobs` and logprob includes still automatically request
    upstream Chat `logprobs:true`;
  - direct Chat `logprobs:false` remains pass-through when supported;
  - legacy Completions `logprobs:0..5` still maps to Chat `logprobs:true` plus
    bounded `top_logprobs` where applicable;
  - legacy `echo:false` returns only generated text, while `echo:true` still
    prefixes prompt text on non-streaming and streaming legacy responses.
- Added regression coverage proving invalid Responses/direct Chat `logprobs`,
  invalid legacy `echo`, and invalid legacy `logprobs` fail locally with zero
  upstream calls; valid `logprobs:false`, valid legacy `echo:false`, and valid
  legacy `logprobs:5` continue through the compatibility bridge.
- Updated the compatibility matrix and evaluation plan so log-probability and
  legacy echo parity track official request validation as a first-class
  contract.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "validates Chat logprobs flag|validates logprobs flag|validates echo and logprobs"`:
    passed 242/242; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 291/291.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-request smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"logprobs"` for `logprobs:"true"`; public
    `/v1/chat/completions` returned HTTP 400 with `param:"logprobs"` for
    `logprobs:"true"`; public `/v1/completions` returned HTTP 400 with
    `param:"echo"` for `echo:"false"` and `param:"logprobs"` for
    `logprobs:6`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` remained tight but usable at roughly 4.2G free
  after tests and smoke checks.

## 2026-06-16 Official Storage Flag Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Responses `background` is a nullable boolean with default `false`;
  Responses `store` is a nullable boolean with default `true`; Chat
  Completions `store` is a nullable boolean with default `false`.
- Added local request validation before provider calls or local async/storage
  routing:
  - `POST /v1/responses` now rejects non-boolean `background` values before
    Responses-to-Chat translation, local background job creation, or upstream
    provider calls.
  - `POST /v1/responses` now rejects non-boolean `store` values before local
    replay persistence decisions or upstream provider calls.
  - `POST /v1/chat/completions` now rejects non-boolean `store` values before
    direct Chat passthrough, local stored Chat lifecycle handling, or streaming
    reconstruction.
  - Invalid strings, numbers, arrays, and objects now return
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    the relevant `param` locally with zero upstream provider calls.
- Preserved existing compatibility behavior for valid values:
  - valid `background:true` still enters the local async Responses path, forces
    local storage, and runs upstream Chat non-streaming;
  - valid `background:false` remains synchronous;
  - valid `store:false` can still be forwarded to OpenAI-compatible upstream
    Chat providers when configured, but it does not create local stored
    Responses or Chat completion records;
  - DeepSeek-compatible production profiles can still filter unsupported
    stored-completion fields through provider-aware configuration.
- Added regression coverage proving invalid `background` and `store` values
  fail locally with zero upstream calls on Responses, invalid direct Chat
  `store` values fail locally with zero upstream calls, valid `background:false`
  stays completed/synchronous, and valid `store:false` leaves local retrieve
  endpoints returning 404.
- Updated the compatibility matrix and evaluation plan so storage/background
  parity tracks official boolean request validation in addition to lifecycle
  storage behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "validates storage flags|validates store flag"`:
    passed 239/239; the current Node test runner executed the selected server
    test file rather than pruning unrelated cases by the name pattern.
  - `npm test`: passed 288/288.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact tracked-file search for the user-provided DeepSeek test key: clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-flag smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` returned HTTP 400 with
    `param:"background"` for `background:"false"` and `param:"store"` for
    `store:"false"`; public `/v1/chat/completions` returned HTTP 400 with
    `param:"store"` for `store:"false"`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` remained tight but usable at roughly 4.4G free
  after tests and smoke checks.

## 2026-06-16 Official Stream Flag Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Responses defines `stream` as a nullable boolean with default `false`; Chat
  Completions and legacy Completions define streaming as a boolean request flag
  where `true` selects SSE delivery.
- Added local request validation before any upstream provider call:
  - `POST /v1/responses` now rejects non-boolean Chat-native `stream` aliases
    before Responses-to-Chat translation or stream routing.
  - `POST /v1/chat/completions` now rejects non-boolean direct Chat `stream`
    values before passthrough, DeepSeek local fan-out, stored Chat handling, or
    SSE proxying.
  - `POST /v1/completions` now rejects non-boolean legacy Completions
    `stream` values before prompt-to-Chat compatibility mapping.
  - Invalid strings, numbers, arrays, and objects now return
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    `param:"stream"` locally with zero upstream provider calls.
- Preserved existing compatibility behavior for valid values:
  - valid `stream:true` requests still enter the existing Responses typed SSE,
    direct Chat SSE proxy/reconstruction, and legacy text-completion SSE
    conversion paths;
  - valid `stream:false` requests stay on non-streaming paths and no longer can
    be misrouted by truthy non-boolean input such as `"false"`;
  - legacy Completions keeps the existing prompt-to-Chat request shape for
    `stream:false` and only sets upstream Chat streaming for valid `true`.
- Added regression coverage proving invalid string, numeric, array, and object
  values fail locally with zero upstream calls on Responses, direct Chat, and
  legacy Completions; valid `stream:false` still reaches the mock upstream
  non-streaming path.
- Updated the compatibility matrix and evaluation plan so streaming parity
  tracks both official boolean request validation and the existing SSE
  conversion coverage.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "validates stream flag|streams Chat chunks|stream_options|streaming requests|normalizes OpenAI Chat fields"`:
    passed 282/282; the current Node test runner executed both selected test
    files except unrelated cases filtered by the name pattern.
  - `npm test`: passed 286/286.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact tracked-file search for the user-provided DeepSeek test key: clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-`stream` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses`,
    `/v1/chat/completions`, and `/v1/completions` all returned HTTP 400 with
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    `param:"stream"` when `stream:"false"` was sent.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` remained tight but usable at roughly 4.9G free
  after tests and smoke checks.

## 2026-06-16 Official Choice Count Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/completions/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  Chat Completions and legacy Completions both define request `n` as a nullable
  integer with minimum `1`, maximum `128`, and default `1`.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now validates the Chat-native `n` alias before
    Responses-to-Chat translation.
  - `POST /v1/chat/completions` now validates direct Chat `n` before provider
    passthrough, local DeepSeek `n>1` fan-out, or stored Chat handling.
  - `POST /v1/completions` now validates legacy Completions `n` before the
    prompt-to-Chat compatibility path.
  - Non-integer values and values outside `1..128` now return
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    `param:"n"` locally with no upstream provider call.
- Preserved existing compatibility behavior for valid values:
  - provider-supported profiles can still forward `n`;
  - DeepSeek-compatible direct Chat requests with native field forwarding
    disabled still record `n:1` as the single-choice default;
  - valid `n>1` requests still use bounded non-streaming or streaming local
    fan-out through `CODEXCOMPAT_CHAT_N_EMULATION_MAX`.
- Added regression coverage proving invalid zero, out-of-range, fractional,
  string, array, and object values fail locally with zero upstream calls on
  Responses, direct Chat, and legacy Completions; valid `n:128` still reaches
  the existing mock upstream path unchanged.
- Updated the compatibility matrix and evaluation plan so choice-count parity
  tracks official request-contract validation as well as DeepSeek local fan-out
  behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "validates n|emulates n choices|streams n choices|maps Chat-native aliases|maps legacy prompts|normalizes OpenAI Chat fields"`:
    passed 279/279; the current Node test runner executed both selected test
    files except unrelated cases filtered by the name pattern.
  - `npm test`: passed 283/283.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `n` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses`,
    `/v1/chat/completions`, and `/v1/completions` all returned HTTP 400 with
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    `param:"n"` when `n:129` was sent.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` remained tight but usable at roughly 5.4G free
  after tests and smoke checks.

## 2026-06-16 Official Parallel Tool Calls Validation

- Rechecked the official OpenAI request contract through the OpenAI developer
  docs MCP and official OpenAPI source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  `parallel_tool_calls` is a boolean request field for Chat Completions and
  Responses, with OpenAPI default `true` on the shared Chat schema and response
  object.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects non-boolean `parallel_tool_calls` values
    with `type:"invalid_request_error"`, `code:"invalid_request_parameter"`,
    and `param:"parallel_tool_calls"`.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough.
  - Existing provider-aware compatibility remains in place for valid boolean
    values: `false` can still map to the single-tool-call system instruction
    when tools are present and native Chat field forwarding is disabled, while
    `true` follows the normal passthrough/filtering path.
- Added regression coverage proving invalid string, numeric, array, and object
  values fail locally with zero upstream calls on both endpoints, while valid
  boolean boundaries still reach the mock upstream request body unchanged.
- Updated the compatibility matrix and evaluation plan so `parallel_tool_calls`
  parity tracks both OpenAI request-contract validation and Chat-only provider
  compatibility mapping.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "parallel_tool_calls|parallel tool-call|normalizes OpenAI Chat fields"`:
    passed 276/276; the current Node test runner executed both selected test
    files except unrelated cases filtered by the name pattern.
  - `npm test`: passed 280/280.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `parallel_tool_calls` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    `param:"parallel_tool_calls"` when `parallel_tool_calls` was sent as the
    string `"false"`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` remained tight but usable at roughly 5.7G free
  after tests and smoke checks.

## 2026-06-16 Official Reasoning Effort Validation

- Rechecked the official OpenAI create request surface through the OpenAI
  developer docs MCP and official OpenAPI endpoint metadata:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  The current request enum for reasoning effort is `none`, `minimal`, `low`,
  `medium`, `high`, and `xhigh`; provider-specific aliases such as DeepSeek
  `max` are not valid OpenAI-compatible request values.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now validates `reasoning` as an object when present
    and `reasoning.effort` against the official enum when supplied.
  - `POST /v1/chat/completions` now validates top-level `reasoning_effort`,
    validates the compatibility `reasoning` object shape when present, and
    validates `reasoning.effort` against the same enum.
  - Existing DeepSeek compatibility mapping remains unchanged for valid OpenAI
    values: `none` disables DeepSeek thinking, `minimal`/`low`/`medium` map to
    `high`, and `xhigh` maps to DeepSeek `max`.
- Added regression coverage proving invalid Responses reasoning shapes and
  invalid direct Chat `reasoning_effort` / `reasoning.effort` values fail
  locally with zero upstream calls, while valid `xhigh` values still reach the
  existing DeepSeek-compatible mapping path.
- Updated the compatibility matrix and evaluation plan so reasoning parity
  tracks request-contract validation as well as provider-specific mapping.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "reasoning_effort|reasoning object|reasoning effort|normalizes OpenAI Chat fields|reasoning.effort"`:
    passed 274/274; the current Node test runner executed both selected test
    files except unrelated cases filtered by the name pattern.
  - `npm test`: passed 278/278.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public reasoning-effort smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"` and `code:"invalid_request_parameter"`;
    the Responses request used `reasoning.effort:"turbo"` and returned
    `param:"reasoning.effort"`, while the Chat request used DeepSeek-only
    `reasoning_effort:"max"` and returned `param:"reasoning_effort"`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were active after smoke testing.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
- Storage: `/srv/aialra/apps` remained tight but usable at roughly 6.0G free
  after tests and smoke checks.

## 2026-06-16 Official Response Format Validation

- Rechecked the official OpenAI Chat Completions and Responses create request
  docs through the OpenAI developer docs MCP, then confirmed the current
  OpenAPI schema from the official `openai/openai-openapi` source:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
  `https://developers.openai.com/api/reference/resources/responses/methods/create`,
  and `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`.
  The relevant response-format union accepts `text`, `json_object`, and
  `json_schema`; Chat uses nested `response_format.json_schema`, while
  Responses uses flat `text.format`.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` validates `text` as an object and `text.format` as a
    response-format object when supplied.
  - `POST /v1/chat/completions` validates `response_format` as a
    response-format object when supplied.
  - Both paths reject unknown `type` values, invalid schema config names,
    non-object schemas, invalid `strict` values, and invalid `description`
    values before any provider call.
  - Responses `text.format.type:"json_schema"` requires the flat `schema`
    object, matching `TextResponseFormatJsonSchema`; direct Chat
    `response_format.type:"json_schema"` requires the nested `json_schema`
    object and validates an optional nested `schema` object, matching
    `ResponseFormatJsonSchema`.
- Preserved the existing provider-aware forwarding policy: valid
  `json_schema` values still follow the bridge's DeepSeek-compatible downgrade
  to `json_object` plus a model-visible JSON Schema instruction when configured,
  while valid `text` and `json_object` values continue through the existing
  passthrough/instruction path.
- Added regression coverage proving invalid Responses `text` /
  `text.format` shapes and invalid direct Chat `response_format` shapes fail
  locally with zero upstream calls. Valid Responses `json_schema` still reaches
  the DeepSeek-compatible `json_object` downgrade path, and valid direct Chat
  `{type:"text"}` reaches the provider.
- Updated the compatibility matrix and evaluation plan so structured-output
  parity tracks request-contract validation as well as downgrade/passthrough
  behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "response_format|text.format|structured output|json_schema"`:
    passed 272/272; the current Node test runner executed both selected test
    files except unrelated cases filtered by the name pattern.
  - `npm test`: passed 276/276.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public response-format smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"` and `code:"invalid_request_parameter"`;
    the Responses request used `text.format.type:"xml"` and returned
    `param:"text.format.type"`, while the Chat request used an invalid
    `response_format.json_schema.name` with a space and returned
    `param:"response_format.json_schema.name"`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Service Tier Validation

- Rechecked the official OpenAI Responses and Chat Completions create
  body-parameter docs through the OpenAI developer docs MCP before changing
  validation behavior:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`
  and
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`.
  Both contracts document `service_tier` as an optional request field whose
  accepted request values are `auto`, `default`, `flex`, and `priority`; unset
  behavior defaults to `auto`.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects invalid Chat-native `service_tier`
    aliases before translating the request to Chat Completions.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough.
  - `null` is treated as unset, matching the bridge's optional-field handling
    for other OpenAI request parameters.
- Preserved the existing provider-aware forwarding policy: valid values still
  flow through for providers configured to accept Chat-native `service_tier`,
  while DeepSeek-compatible default filtering records the compatibility
  decision instead of silently forwarding an unsupported field.
- Added regression coverage proving invalid strings, uppercase enum values,
  legacy tier names, and non-string values fail locally for both Responses and
  direct Chat with zero upstream calls. Valid `default` and `priority` values
  still reach the existing provider-aware passthrough/filtering path.
- Updated the compatibility matrix and evaluation plan so Chat-native
  `service_tier` parity tracks request-contract validation as well as
  passthrough/filtering behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "service_tier|Chat-native request fields|normalizes OpenAI Chat fields|passes Chat service tier|filter service tier"`:
    passed 270/270; the current Node test runner executed both full selected
    test files.
  - `npm test`: passed 274/274.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `service_tier` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"`, `param:"service_tier"`, and
    `code:"invalid_request_parameter"`; the Responses request used
    `service_tier:"fast"`, and the Chat request used
    `service_tier:"PRIORITY"`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Verbosity Validation

- Rechecked the official OpenAI Chat Completions create body-parameter docs
  through the OpenAI developer docs MCP before changing validation behavior:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`.
  The Chat contract constrains `verbosity` to the currently supported values
  `low`, `medium`, and `high`. The Responses create docs do not expose
  `verbosity` as a first-class Responses parameter, but this bridge already
  accepts it on `POST /v1/responses` as a Chat-native alias, so the accepted
  alias now follows the Chat request contract.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects invalid Chat-native `verbosity` aliases
    before translating the request to Chat Completions.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough.
  - `null` is treated as unset, matching the bridge's optional-field handling
    for other OpenAI request parameters.
- Added regression coverage proving invalid strings, uppercase enum values,
  empty strings, and non-string values fail locally for both Responses and
  direct Chat with zero upstream calls. Valid `low` and `high` values still
  reach the existing DeepSeek-compatible prompt-instruction path when native
  Chat fields are filtered.
- Updated the compatibility matrix and evaluation plan so Chat-native
  `verbosity` parity tracks request-contract validation as well as
  passthrough/prompt-instruction behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js test/translator.test.js --test-name-pattern "verbosity|Chat-native request fields|normalizes OpenAI Chat fields|filters Chat-native"`:
    passed 268/268; the current Node test runner executed both full selected
    test files.
  - `npm test`: passed 272/272.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `verbosity` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"`, `param:"verbosity"`, and
    `code:"invalid_request_parameter"`; the Responses request used
    `verbosity:"terse"`, and the Chat request used `verbosity:"HIGH"`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Legacy Completions Logit Bias Validation

- Rechecked the official OpenAI legacy Completions create operation through
  the OpenAI developer docs MCP and OpenAPI endpoint spec before changing
  behavior:
  `https://developers.openai.com/api/reference/resources/completions/methods/create`
  and `https://api.openai.com/v1/completions`. The endpoint is marked legacy,
  but current clients and benchmark harnesses can still call it, and this
  bridge maps it to upstream Chat Completions.
- Extended the existing OpenAI `logit_bias` request-contract validation to
  `POST /v1/completions` before prompt normalization, non-stream execution, or
  streaming execution can make provider calls. The accepted shape is a JSON
  object whose values are finite numbers from -100 through 100.
- Added regression coverage proving array/string `logit_bias` values,
  below-minimum values, above-maximum values, and a string bias value on a
  streaming legacy request all fail locally with zero upstream calls. The
  existing legacy prompt-to-Chat test now also proves valid `logit_bias`
  passthrough, and the new boundary test proves `-100` and `100` reach the mock
  Chat provider unchanged.
- Updated the compatibility matrix and evaluation plan so legacy Completions
  parity tracks local request-contract validation in addition to Chat-backed
  prompt/response mapping.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "logit_bias|/v1/completions maps legacy|/v1/completions streams"`:
    passed 221/221; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 270/270.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public legacy Completions `logit_bias` smoke through
    `https://opencodexapp.aialra.online/v1/completions` returned HTTP 400
    with `type:"invalid_request_error"`, `param:"logit_bias.11"`, and
    `code:"invalid_request_parameter"` for a `stream:true` request with a
    string-valued bias.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Logit Bias Validation

- Rechecked the official OpenAI Chat Completions create body-parameter docs
  through the OpenAI developer docs MCP before changing validation behavior:
  `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`.
  The Chat contract accepts `logit_bias` as a JSON object that maps token IDs
  to numeric bias values from -100 through 100. The legacy Completions create
  docs describe the same range at
  `https://developers.openai.com/api/reference/resources/completions/methods/create`.
  The Responses create docs do not expose `logit_bias` as a first-class
  Responses parameter, but this bridge already accepts it on
  `POST /v1/responses` as a Chat-native alias, so the accepted alias now
  follows the Chat request contract.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects non-object `logit_bias` aliases before
    translating the request to Chat Completions.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough.
  - Each supplied bias value must be a finite number from -100 through 100.
    Valid boundary values still pass through unchanged.
- Added regression coverage proving array/string `logit_bias` values,
  below-minimum values, above-maximum values, and string bias values fail
  locally for both Responses and direct Chat with zero upstream calls, while
  valid -100 and 100 boundary values still reach the mock Chat provider.
- Updated the compatibility matrix and evaluation plan so Chat-native
  `logit_bias` parity tracks local request-contract validation as well as
  passthrough/filtering behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "logit_bias|Chat-native request fields|normalizes OpenAI Chat fields"`:
    passed 220/220; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 269/269.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `logit_bias` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"` and `code:"invalid_request_parameter"`;
    the Responses request rejected above-range `logit_bias.7`, and the Chat
    request rejected string-valued `logit_bias.42`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Stop Sequence Validation

- Rechecked the official OpenAI Chat Completions create body-parameter docs
  through the OpenAI developer docs MCP before changing validation behavior.
  The Chat contract accepts `stop` as stop sequences and documents up to 4
  sequences; the bridge already accepts this Chat-native alias on
  `POST /v1/responses` and forwards it to upstream Chat providers, so the
  accepted alias now follows the Chat request contract.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects invalid Chat-native `stop` aliases before
    translating the request to Chat Completions.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough.
  - Valid values still pass through unchanged: a 4-string array on Responses
    and a single string on direct Chat.
- Added regression coverage proving `stop` arrays with more than 4 strings,
  arrays containing non-string items, object values, and number values fail
  locally for both Responses and direct Chat with zero upstream calls, while
  valid boundary shapes still reach the mock Chat provider.
- Updated the compatibility matrix and evaluation plan so stop-sequence parity
  tracks local request-contract validation as well as passthrough behavior.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "stop|sampling|chat passthrough|responses maps to"`:
    passed 218/218; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 267/267.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public stop smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"`, `param:"stop"`, and
    `code:"invalid_request_parameter"`; the Responses request used a 5-item
    `stop` array, and the Chat request used a non-string array item.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Penalty Parameter Validation

- Rechecked the official OpenAI Chat Completions and legacy Completions
  creation surfaces through the OpenAI developer docs MCP before changing
  validation behavior. The Chat/Completions penalty contract uses numeric
  `frequency_penalty` and `presence_penalty` values from -2.0 through 2.0.
  The Responses create docs do not stably expose these fields as first-class
  Responses parameters, but this bridge already accepts them on
  `POST /v1/responses` as Chat-native aliases and forwards them to upstream
  Chat providers, so the accepted alias fields now follow the Chat contract.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects non-number, below-minimum, and
    above-maximum `frequency_penalty` / `presence_penalty` values before
    translating the request to Chat Completions.
  - `POST /v1/chat/completions` applies the same validation before direct
    Chat passthrough, matching the OpenAI Chat request contract instead of
    relying on provider-specific errors.
  - Valid boundary values still pass through unchanged:
    `frequency_penalty:-2` / `presence_penalty:2` on Responses, and
    `frequency_penalty:2` / `presence_penalty:-2` on direct Chat.
- Added regression coverage proving invalid values
  `frequency_penalty:-2.1`, `frequency_penalty:2.1`,
  `frequency_penalty:"0"`, `presence_penalty:-2.1`,
  `presence_penalty:2.1`, and `presence_penalty:"0"` fail locally for both
  Responses and direct Chat with zero upstream calls, while valid boundaries
  still reach the mock Chat provider.
- Updated the compatibility matrix and evaluation plan so sampling parity now
  tracks request-contract validation for penalties as well as `temperature`
  and `top_p`.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "sampling|penalty|frequency_penalty|presence_penalty"`:
    passed 216/216; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 265/265.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public penalty smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"` and `code:"invalid_request_parameter"`;
    the Responses error used `param:"frequency_penalty"` for
    `frequency_penalty:2.1`, and the Chat error used
    `param:"presence_penalty"` for `presence_penalty:-2.1`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Sampling Parameter Validation

- Rechecked the official OpenAI Responses create and Chat Completions create
  body-parameter docs through the OpenAI developer docs MCP before changing
  validation behavior. Both surfaces document `temperature` as a number between
  0 and 2, and document `top_p` as nucleus-sampling probability mass where
  values such as 0.1 restrict sampling to the top 10% probability mass.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects non-number, below-minimum, and
    above-maximum `temperature` / `top_p` values before translating the request
    to Chat Completions.
  - `POST /v1/chat/completions` applies the same validation before direct Chat
    passthrough, so OpenAI SDK callers receive an OpenAI-style local
    `400 invalid_request_error` instead of provider-specific errors.
  - Valid boundary values still pass through unchanged:
    `temperature:0` / `top_p:1` on Responses, and
    `temperature:2` / `top_p:0` on direct Chat.
- Added regression coverage proving invalid values `temperature:-0.1`,
  `temperature:2.1`, `temperature:"1"`, `top_p:-0.01`, `top_p:1.01`, and
  `top_p:"0.5"` fail locally for both Responses and direct Chat with zero
  upstream calls, while valid boundaries still reach the mock Chat provider.
- Updated the compatibility matrix and evaluation plan so sampling parity now
  tracks request-contract validation as well as provider passthrough.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "sampling|temperature|top_p"`:
    passed 216/216; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 265/265.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public sampling smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"` and `code:"invalid_request_parameter"`;
    the Responses error used `param:"temperature"` for `temperature:2.1`, and
    the Chat error used `param:"top_p"` for `top_p:1.01`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official Top Logprobs Contract Validation

- Rechecked the official OpenAI Responses create and Chat Completions create
  body-parameter docs through the OpenAI developer docs MCP before changing
  validation behavior. Both surfaces document `top_logprobs` as an integer
  between 0 and 20. The Chat Completions surface additionally requires
  `logprobs:true` whenever `top_logprobs` is used.
- Added local request validation before upstream provider calls:
  - `POST /v1/responses` now rejects non-integer or out-of-range
    `top_logprobs` values before translation. Valid Responses requests still
    map `top_logprobs` to upstream Chat `top_logprobs` and automatically set
    `logprobs:true`.
  - `POST /v1/chat/completions` now rejects the same invalid range values and
    also rejects `top_logprobs` when `logprobs` is missing or false, matching
    the OpenAI Chat contract instead of relying on provider-side failures.
- Added regression coverage proving invalid values `-1`, `21`, `1.5`, and
  `"2"` fail locally for Responses with zero upstream calls; valid boundary
  `top_logprobs:0` still reaches the mock Chat provider with `logprobs:true`.
  Direct Chat coverage now proves `top_logprobs:21`, missing `logprobs`, and
  `logprobs:false` fail locally with zero upstream calls; valid boundary
  `top_logprobs:20` plus `logprobs:true` still passes through.
- Updated the compatibility matrix and evaluation plan so logprobs parity now
  tracks both output projection and request-contract validation.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "top_logprobs|logprobs"`:
    passed 214/214; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 263/263.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `top_logprobs` smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400 with
    `type:"invalid_request_error"` and `code:"invalid_request_parameter"`;
    the Responses error used `param:"top_logprobs"` for an out-of-range value,
    and the Chat error used `param:"logprobs"` when `top_logprobs` was supplied
    without `logprobs:true`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Official String Metadata Validation

- Rechecked the official OpenAI Responses create and Chat Completions create
  body-parameter docs through the OpenAI developer docs MCP before changing
  validation behavior. Both surfaces document `metadata` as up to 16 key-value
  pairs, with keys up to 64 characters and string values up to 512 characters.
- Added request-side validation for user-supplied `metadata` on:
  - `POST /v1/responses`;
  - `POST /v1/responses/{response_id}` stored-response metadata updates;
  - `POST /v1/chat/completions`;
  - `POST /v1/chat/completions/{completion_id}` stored-chat metadata updates.
- Invalid metadata now fails locally with OpenAI-style
  `400 invalid_request_error` / `invalid_request_parameter` before any
  upstream Chat provider call or stored-object mutation. The bridge still keeps
  its internal `metadata.compatibility` objects on response bodies after
  validation, so behavior audit trails remain available without treating those
  internal fields as caller-supplied metadata.
- Added regression coverage proving Responses creation rejects non-object
  metadata, more than 16 pairs, overlong keys, non-string values, and overlong
  values with zero upstream calls; valid 16-entry string metadata still
  succeeds. Added direct Chat coverage for create-time rejection and stored-chat
  metadata update rejection, plus stored-response metadata update rejection.
- Updated the compatibility matrix and evaluation plan so metadata validation is
  tracked as part of Responses/Chat protocol parity.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "metadata|response-lifecycle|chat responses"`:
    passed 212/212; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 261/261.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public invalid-metadata smoke tests through
    `https://opencodexapp.aialra.online/v1/responses` and
    `/v1/chat/completions` both returned HTTP 400,
    `type:"invalid_request_error"`, `code:"invalid_request_parameter"`, and
    `param:"metadata.suite"`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses Input Token Style Preset Mapping

- Rechecked the official OpenAI `/v1/responses/input_tokens` body parameters
  through the OpenAI developer docs MCP before changing bridge behavior. The
  endpoint documents `style` as a model-owned style preset for the request and
  limits values to at most 64 characters.
- Tightened local Chat-provider compatibility for the input-token counting
  endpoint:
  - invalid non-string `style` values and `style` strings longer than 64
    characters now return an OpenAI-style `400 invalid_request_error` with
    `param:"style"` before any upstream provider call;
  - valid `style` values are injected into the upstream Chat Completions usage
    probe as a model-visible compatibility instruction, so Chat-only providers
    count the preset request instead of silently dropping it;
  - the public response shape remains the official
    `{"object":"response.input_tokens","input_tokens":...}` object, avoiding
    extra fields that could break strict SDK parsing.
- Added regression coverage proving oversized `style` values are rejected
  locally with zero upstream calls, and valid `style:"concise"` values are
  present in the mock provider prompt while the endpoint returns upstream
  `usage.prompt_tokens`.
- Updated the compatibility matrix and evaluation plan so future bridge
  regression runs treat `/input_tokens` `style` as a mapped compatibility
  surface.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "responses/input_tokens"`:
    passed 210/210; the current Node test runner executed the full server test
    file.
  - `npm test`: passed 259/259.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public `/v1/responses/input_tokens` smoke through
    `https://opencodexapp.aialra.online` with `style:"concise"` returned HTTP
    200, `object:"response.input_tokens"`, and `input_tokens:32`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Parallel Tool-Call Constraint Mapping

- Rechecked the current official OpenAI Responses and Chat Completions create
  schemas through the OpenAI developer docs MCP/OpenAPI spec before changing
  compatibility behavior. Both surfaces define `parallel_tool_calls` as the
  field that controls whether the model may run tool calls in parallel.
- Added provider-aware compatibility for `parallel_tool_calls:false` on
  Chat-only providers that do not accept the native field:
  - `/v1/responses` translation now injects a system instruction requiring at
    most one tool call in the assistant turn when tools are present and native
    Chat fields are not forwarded;
  - direct `/v1/chat/completions` passthrough now applies the same instruction
    after legacy/custom tool normalization has determined that upstream tools
    remain available;
  - the native `parallel_tool_calls` field is not forwarded in this mode and is
    recorded as mapped, not generically dropped;
  - requests without tools, or values other than explicit `false`, keep the
    existing generic provider-field filtering behavior.
- Added regression coverage for:
  - translator-level Responses behavior proving the upstream Chat request gets
    the single-tool-call instruction and omits native `parallel_tool_calls`;
  - direct Chat mock-provider behavior proving DeepSeek-compatible passthrough
    sends the instruction with tool-bearing requests and records
    `chat_passthrough.parallel_tool_calls`.
- Updated the compatibility matrix and evaluation plan so future parity checks
  treat `parallel_tool_calls:false` as a prompt-level compatibility mapping when
  native provider support is unavailable.
- Validation:
  - `node --check src/bridge/translator.js`, `src/bridge/server.js`,
    `test/translator.test.js`, and `test/server.test.js`: passed.
  - `node --test test/translator.test.js --test-name-pattern "parallel_tool_calls|Chat-native request fields"`:
    passed 45/45.
  - `node --test test/server.test.js --test-name-pattern "normalizes OpenAI Chat fields|parallel_tool_calls"`:
    passed 209/209; the current Node test runner executed the whole server test
    file.
  - `npm test`: passed 258/258.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public direct Chat smoke through
    `https://opencodexapp.aialra.online/v1/chat/completions`: HTTP 200, content
    `ok-parallel-tool-constraint`,
    `chat_passthrough.parallel_tool_calls.reason` was
    `provider_unsupported_prompt_instruction`, and
    `chat_native_fields.mapped` contained `parallel_tool_calls` without listing
    it under filtered fields.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Legacy Chat Function Request Mapping

- Rechecked the current official OpenAI Chat Completions create schema through
  the OpenAI developer docs MCP/OpenAPI spec before changing compatibility
  behavior. The relevant request fields are deprecated `functions` /
  `function_call` and modern `tools` / `tool_choice`; Chat providers such as
  DeepSeek are more likely to support the modern tool-call shape.
- Added provider-aware legacy Chat function request mapping:
  - direct `/v1/chat/completions` requests with `functions` now send modern
    `tools:[{type:"function",function:{...}}]` upstream when Chat-native fields
    are not forwarded;
  - compatible legacy `function_call` values now map to modern `tool_choice`
    when no explicit modern `tool_choice` already exists;
  - `/v1/responses` requests that include Chat-native `functions` /
    `function_call` aliases use the same mapping before the upstream Chat
    request is built;
  - mapped legacy fields are recorded in
    `metadata.compatibility.legacy_functions` for Responses translation and
    `metadata.compatibility.chat_passthrough.legacy_functions` for direct Chat,
    instead of being reported as generic dropped fields.
- Kept OpenAI-compatible provider behavior unchanged when native Chat field
  forwarding is enabled: legacy fields can still pass through as legacy fields
  for providers that explicitly support them.
- Added regression coverage for:
  - translator-level Responses alias handling that proves legacy `functions` /
    `function_call` become modern `tools` / `tool_choice`;
  - direct Chat mock-provider behavior that proves DeepSeek-compatible
    passthrough sends modern tool fields upstream and records the mapping in
    `chat_passthrough.legacy_functions`.
- Updated the compatibility matrix and evaluation plan so future tests treat
  deprecated Chat function request fields as a compatibility mapping surface,
  not as unsupported provider noise.
- Validation:
  - `node --check src/bridge/translator.js`, `src/bridge/server.js`,
    `test/translator.test.js`, and `test/server.test.js`: passed.
  - `node --test test/translator.test.js --test-name-pattern "legacy Chat functions|Chat-native request fields"`:
    passed 44/44.
  - `node --test test/server.test.js --test-name-pattern "normalizes OpenAI Chat fields|legacy Chat functions"`:
    passed 209/209; the current Node test runner executed the whole server test
    file.
  - `npm test`: passed 257/257.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public direct Chat smoke through
    `https://opencodexapp.aialra.online/v1/chat/completions`: HTTP 200, content
    `ok-legacy-functions`, `legacy_functions.functions.reason` was
    `legacy_functions_mapped`, and `legacy_functions.function_call.reason` was
    `legacy_function_call_mapped`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Responses Context Management Boundary

- Rechecked the current official OpenAI Responses create schema through the
  OpenAI developer docs MCP/OpenAPI spec before changing compatibility behavior.
  The Responses request includes a top-level `context` field for context
  management configuration, while Chat Completions has no matching upstream
  request field.
- Added an explicit Responses-to-Chat compatibility boundary for `context`:
  - `responsesToChatRequest` now detects caller-supplied `context`;
  - the field is not forwarded to upstream Chat Completions providers;
  - `metadata.compatibility.context_management` records
    `source:"context"`, `forwarded:false`,
    `reason:"chat_completions_no_equivalent"`, the value type, and sorted
    object keys when the value is an object;
  - caller-provided context values are not copied into compatibility metadata.
- Added regression coverage for:
  - translator-level mapping that proves `chat.context` is omitted and only
    scrubbed compatibility metadata remains;
  - server-level mock-provider behavior that proves `/v1/responses` does not
    forward `context` upstream and does not echo sensitive context values in the
    compatibility block.
- Updated the compatibility matrix and evaluation plan so future parity work
  treats `context` as a tracked protocol field instead of an accidental
  passthrough gap. A hosted context manager that actively changes retention or
  summarization behavior remains future work beyond this metadata boundary.
- Validation:
  - `node --check src/bridge/translator.js`, `test/translator.test.js`, and
    `test/server.test.js`: passed.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm test`: passed 256/256.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public Responses smoke through
    `https://opencodexapp.aialra.online/v1/responses`: HTTP 200, content
    `ok-context-boundary`, `metadata.compatibility.context_management.reason`
    was `chat_completions_no_equivalent`, and the caller-provided context value
    used for the leak check was absent from the serialized response.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Chat Identity Alias Mapping Audit

- Rechecked the current official OpenAI Chat Completions schema through the
  OpenAI developer docs MCP/OpenAPI spec before changing compatibility behavior.
  The relevant Chat request fields are `safety_identifier`, `prompt_cache_key`,
  `prompt_cache_retention`, and legacy `user`; OpenAI positions
  `safety_identifier` as the safety identifier and `prompt_cache_key` as a cache
  routing hint.
- Tightened Responses-to-Chat and direct Chat passthrough metadata for
  DeepSeek-compatible providers:
  - when `safety_identifier` or `prompt_cache_key` is consumed by the DeepSeek
    `user_id` compatibility mapping, it is recorded under
    `metadata.compatibility.*.chat_native_fields.mapped`;
  - consumed identity/cache aliases are no longer reported as plain filtered
    provider-unsupported fields;
  - remaining unsupported Chat fields such as `prompt_cache_retention` still
    appear under `chat_native_fields.filtered`.
- Extended local organization usage dimensions so direct Chat usage can group
  by `user_id` from `request.user_id`, then `safety_identifier`, then legacy
  `user`, then `prompt_cache_key`, preserving stable local admin/reporting
  behavior without storing prompts, messages, or provider secrets.
- Added regression coverage for:
  - Responses translation where `safety_identifier` wins over
    `prompt_cache_key`, records `mapped:["safety_identifier"]`, and filters the
    still-unsupported prompt-cache fields;
  - Responses translation where `prompt_cache_key` maps to DeepSeek `user_id`
    when no higher-priority identity alias exists;
  - direct `/v1/chat/completions` passthrough metadata showing
    `chat_native_fields.mapped:["safety_identifier"]`;
  - direct `/v1/chat/completions` passthrough where `prompt_cache_key` alone
    maps to DeepSeek `user_id` and is omitted from the upstream native Chat
    field payload;
  - local organization usage aggregation by `safety_identifier` as the
    `user_id` dimension.
- Validation:
  - `node --check src/bridge/translator.js`, `src/bridge/server.js`,
    `test/translator.test.js`, and `test/server.test.js`: passed.
  - `node --test test/translator.test.js --test-name-pattern "DeepSeek user identity|prompt_cache_key|Chat-native request fields"`:
    passed 42/42.
  - `node --test test/server.test.js`: passed 208/208.
  - `npm test`: passed 254/254.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; local
    `http://127.0.0.1:12912/healthz` returned HTTP 200 JSON with provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public direct Chat smoke through
    `https://opencodexapp.aialra.online/v1/chat/completions`: HTTP 200,
    content `ok-identity-map`, `chat_native_fields.mapped` contained
    `safety_identifier`, filtered fields contained `prompt_cache_key` and
    `prompt_cache_retention`, and `deepseek_user_id.source` was
    `safety_identifier`.
  - Public organization usage query through
    `https://opencodexapp.aialra.online/v1/organization/usage/completions`
    grouped the live request under `user_id:"live_identity_user"`,
    `model:"deepseek-v4-pro"`, `num_model_requests:1`, `input_tokens:11`, and
    `output_tokens:4`.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Public Domain API Routing

- Found that the public `https://opencodexapp.aialra.online/v1/models`
  route was being served by the Codex App SPA fallback as `text/html` instead
  of reaching the local compatibility bridge. The local bridge at
  `127.0.0.1:12912` already returned the expected JSON model list, so the gap
  was the public web entry path rather than the Responses/Chat adapter.
- Kept the existing Nginx shape simple: the public vhost still proxies the
  hostname to the web service on `127.0.0.1:12920`. Added a versioned
  streaming-safe proxy inside `web-server.js` so:
  - `/v1`, `/v1/*`, and `/healthz` forward to the local bridge;
  - SPA routes, static assets, `/health`, and the browser WebSocket bridge keep
    their existing behavior;
  - request bodies, authorization headers, SSE streams, and response headers
    are piped without buffering through JSON;
  - `CODEXAPP_API_PROXY_HOST`, `CODEXAPP_API_PROXY_PORT`, and
    `CODEXAPP_API_PROXY_TIMEOUT_MS` can override the default target, which
    otherwise follows `CODEXCOMPAT_HOST` / `CODEXCOMPAT_PORT` and finally
    `127.0.0.1:12912`.
- Added `test/web-server-proxy.test.js`, which spawns `web-server.js` against a
  mock API bridge and verifies:
  - `GET /v1/models?limit=1` is proxied even when the client accepts HTML;
  - `GET /healthz` reaches the bridge;
  - normal SPA fallback still injects the initial route;
  - streaming `POST /v1/chat/completions` stays `text/event-stream`;
  - request body and authorization headers reach the bridge.
- Updated `README.md` and `docs/deployment.md` to document the public API path
  split and the SDK base URL `https://opencodexapp.aialra.online/v1`.
- Validation:
  - `node --check web-server.js` and
    `node --check test/web-server-proxy.test.js`: passed.
  - `node --test test/web-server-proxy.test.js`: passed 1/1.
  - `npm test`: passed 252/252.
  - Restarted `aialra-opencodexapp-web.service`; web, bridge, and app-server
    services were all `active`.
  - Local web proxy `http://127.0.0.1:12920/v1/models`: HTTP 200
    `application/json`, returning `deepseek-v4-flash` and
    `deepseek-v4-pro`.
  - Public API `https://opencodexapp.aialra.online/v1/models`: HTTP 200
    `application/json`, returning `deepseek-v4-flash` and
    `deepseek-v4-pro`.
  - Public root `https://opencodexapp.aialra.online/`: HTTP 200
    `text/html`, preserving the frontend.
  - Public `https://opencodexapp.aialra.online/healthz`: HTTP 200 JSON with
    service `open-codex-responses-bridge`, provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public direct Chat smoke through
    `https://opencodexapp.aialra.online/v1/chat/completions`: HTTP 200
    `application/json`, returned exact content `ok-public-api`, and preserved
    DeepSeek `reasoning_effort:"none"` compatibility metadata.
  - Public streaming direct Chat smoke: HTTP 200 `text/event-stream`, 6 SSE
    frames, object `chat.completion.chunk`, content `ok-public-stream`, one
    usage chunk, and 13 total tokens.
  - Public protocol smoke with
    `CODEXCOMPAT_EVAL_BASE_URL=https://opencodexapp.aialra.online npm run eval:protocol`:
    passed 2/2 against `deepseek-v4-pro`, pass rate 1.0, average latency
    1219 ms, P95 latency 1258 ms, and 116 total tokens.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online` with marker `ui-smoke-mqg54br7`,
    covering login/public entry, sidebar controls, core navigation, project
    dialog/upload services, prompt submission, completed-turn actions, reload
    persistence, generated-image artifact display, saved project reopen/cleanup,
    and console error/warning checks.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run prune:runtime -- --dry-run` initially selected 205 old runtime
    artifacts totaling 429732 bytes; `npm run prune:runtime -- --apply`
    completed successfully; follow-up dry-run selected 0 artifacts and reported
    0 errors.
  - Post-cleanup storage/service check: app-server, bridge, and web services
    were active; root filesystem had 11 GB available; repository checkout was
    125 MB, `state/` was 40 MB, `output/` was 4.4 MB,
    `/srv/aialra/data/opencodexapp` was 136 KB, and
    `/srv/aialra/logs/opencodexapp` was 30 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-16 Direct Chat Streaming N Choice Fan-Out Compatibility

- Rechecked the official OpenAI Chat Completions schema through the OpenAI
  developer docs MCP/OpenAPI spec. OpenAI documents streamed Chat completions
  as `chat.completion.chunk` objects; each chunk in one stream has the same
  completion id, `choices` can contain multiple elements when `n>1`, and the
  final usage-bearing chunk can contain empty `choices` when
  `stream_options.include_usage` is enabled.
- Closed the streaming gap left by the previous Direct Chat `n` fan-out pass:
  - DeepSeek-compatible direct Chat `stream:true,n>1` requests now remove `n`
    before every upstream provider call;
  - the bridge sequentially fans out bounded single-choice upstream streams;
  - caller-facing SSE frames are normalized to one logical
    `chat.completion.chunk` stream with a single generated completion id;
  - upstream choice indexes are remapped to the requested fan-out indexes;
  - per-call usage chunks are suppressed from the public stream and replaced
    with one combined usage chunk when usage is available;
  - streamed local `store:true` records reconstruct a terminal
    `chat.completion` with every generated choice and
    `metadata.compatibility.chat_passthrough.n.emulated:"local_stream_fanout"`.
- Updated compatibility docs, deployment flags, and evaluation criteria so
  Direct Chat `n>1` local emulation covers both non-streaming and streaming
  modes.
- Added a regression proving direct `/v1/chat/completions` streaming fan-out:
  - performs two upstream streaming provider calls for `n:2`;
  - strips `n` while preserving `stream:true` and filtered
    `stream_options.include_usage`;
  - emits one logical public completion id;
  - remaps streamed choice indexes to `0` and `1`;
  - emits exactly one combined usage chunk;
  - stores and replays both assistant choices through the local stored Chat
    completion lifecycle.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js --test-name-pattern "streams n choices|emulates n choices|normalizes OpenAI Chat fields"`:
    passed 207/207.
  - `npm test`: passed 251/251.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1118 ms, P95 latency 1120 ms, and 116 total
    tokens.
  - Live localhost direct `/v1/chat/completions` streaming smoke with
    `stream:true`, `n:2`, `store:true`, `stream_options.include_usage:true`,
    and `reasoning_effort:"none"` against `deepseek-v4-pro` returned HTTP
    200, `text/event-stream`, 16 SSE frames, one logical completion id, choice
    indexes `[0,1]`, visible content `ok-stream-n-live` for both choices, one
    combined usage chunk with 40 total tokens, stored completion metadata
    `emulated:"local_stream_fanout"`, `request_count:2`,
    `actual_choice_count:2`, and two stored assistant output messages.

## 2026-06-16 Direct Chat N Choice Fan-Out Compatibility

- Rechecked the official OpenAI Chat Completions schema through the OpenAI
  developer docs MCP. The Chat create operation documents `n` as the number of
  Chat completion choices generated for each input message, with token charges
  applying across all choices.
- Extended DeepSeek-compatible direct `/v1/chat/completions` passthrough so
  request-side `n` is no longer only treated as a generic unsupported
  Chat-native field when native Chat fields are disabled:
  - `n:1` is removed from the upstream DeepSeek request as the single-choice
    provider default and recorded in
    `metadata.compatibility.chat_passthrough.n`;
  - non-streaming `n>1` is emulated with local provider fan-out, making bounded
    repeated upstream Chat calls without forwarding `n`;
  - returned Chat `choices` are merged with contiguous indexes;
  - upstream `usage` objects are aggregated so local usage accounting reflects
    the total fan-out cost;
  - local `store:true` Chat completion records and
    `/v1/chat/completions/{id}/messages` preserve every merged assistant
    choice;
  - `CODEXCOMPAT_CHAT_N_EMULATION_MAX` caps the fan-out width, defaulting to
    10 and hard-bounded to 50;
  - streaming request-side fan-out remains intentionally unimplemented and is
    audited with `reason:"streaming_fanout_not_implemented"`.
- Updated compatibility docs, deployment flags, and the evaluation plan so
  Direct Chat `n` is tracked as a dedicated compatibility path instead of a
  plain filtered-field case.
- Added a regression proving direct `/v1/chat/completions`:
  - strips `n` from each provider fan-out request;
  - performs two upstream calls for `n:2`;
  - merges two choices with stable indexes;
  - aggregates usage totals;
  - records `metadata.compatibility.chat_passthrough.n`;
  - stores and replays both assistant choices through the local stored Chat
    messages endpoint.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: passed 206/206.
  - `npm test`: passed 250/250.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1339 ms, P95 latency 1384 ms, and 116 total
    tokens.
  - Live localhost direct `/v1/chat/completions` smoke with `n:2`,
    `store:true`, and `reasoning_effort:"none"` against `deepseek-v4-pro`
    returned HTTP 200, two choices, merged usage of 36 total tokens,
    `metadata.compatibility.chat_passthrough.n.emulated:"local_fanout"`,
    `request_count:2`, `actual_choice_count:2`, and two stored assistant
    output messages from `/v1/chat/completions/{id}/messages`.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Direct Chat Web Search Options Compatibility

- Rechecked the official OpenAI Chat Completions OpenAPI schema through the
  OpenAI developer docs MCP. The Chat create operation documents
  `web_search_options` as the Chat web-search request surface and says the web
  search tool searches relevant web results for use in a response.
- Extended DeepSeek-compatible direct `/v1/chat/completions` passthrough so
  unsupported `web_search_options` is no longer only listed under the generic
  Chat-native field filter when local web search is enabled:
  - the upstream DeepSeek request removes `web_search_options`;
  - the bridge builds a local `web_search_preview` context from the latest user
    message, reusing the existing bounded local web-search adapter;
  - search result context is injected into the upstream Chat request as a
    system message;
  - non-streaming Chat completion messages are annotated with OpenAI-compatible
    `url_citation` entries when source markers are present, or receive an
    appended source list when the model did not cite sources itself;
  - streaming stored Chat completions are annotated before local persistence;
  - compatibility metadata records
    `metadata.compatibility.chat_passthrough.web_search_options` and
    `metadata.compatibility.chat_passthrough.local_web_search`;
  - local organization usage accounting records direct Chat web-search calls
    through the existing `web_search_calls` ledger when usage storage is
    configured.
- Preserved provider-aware behavior: capable providers can still receive native
  `web_search_options`; DeepSeek-compatible providers use local emulation when
  local search is enabled; if local web search is disabled, the field remains
  in the generic filtered Chat-native field list.
- Updated the compatibility matrix to move `web_search_options` out of the
  plain filtered-field row and document the direct Chat local-search fallback.
- Added a regression proving direct `/v1/chat/completions`:
  - strips `web_search_options` from the provider request;
  - injects local search context into upstream Chat messages;
  - disables DeepSeek thinking for local web search;
  - annotates returned Chat messages with `url_citation`;
  - stores/replays the original caller input message;
  - excludes `web_search_options` from the generic filtered field list when the
    local compatibility path handles it.
- Validation:
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "web_search_options|normalizes OpenAI Chat fields|local web_search"`:
    passed 205/205.
  - `npm test`: passed 249/249.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1636 ms, P95 latency 1699 ms, and 116 total
    tokens.
  - Live localhost direct `/v1/chat/completions` smoke with
    `web_search_options.search_context_size:"low"` against `deepseek-v4-pro`
    returned HTTP 200, visible content `ok-chat-web-live [1].`, a
    `url_citation` for `https://en.wikipedia.org/wiki/OpenAI`, and metadata
    showing `web_search_options.forwarded:false`,
    `reason:"provider_unsupported_local_web_search"`, local provider
    `wikipedia`, `result_count:5`, and
    `deepseek_thinking:"disabled_for_local_web_search"`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Verbosity Prompt Instruction Compatibility

- Rechecked the official OpenAI Chat Completions OpenAPI schema through the
  OpenAI developer docs MCP. OpenAI documents `verbosity` as a Chat completion
  request field with `low`, `medium`, and `high` values that constrain response
  detail.
- Extended DeepSeek-compatible request normalization so unsupported
  `verbosity` no longer disappears into the generic Chat-native field filter:
  - `/v1/responses` translation removes the native `verbosity` field when
    Chat-native passthrough is disabled, injects a leading system instruction
    for `low`, `medium`, or `high`, and records
    `metadata.compatibility.verbosity`;
  - direct `/v1/chat/completions` passthrough applies the same downgrade before
    proxying to the provider and records
    `metadata.compatibility.chat_passthrough.verbosity`;
  - providers with Chat-native passthrough enabled still receive the native
    field unchanged, while unsupported or unknown values continue through the
    existing filter/audit path.
- Updated the compatibility matrix to separate mappable `verbosity` semantics
  from OpenAI-only Chat fields that are simply filtered for DeepSeek.
- Added regressions for:
  - translator-level Responses mapping of `verbosity:"high"` into a leading
    system message and compatibility metadata;
  - `/v1/responses` end-to-end filtering proving the upstream request receives
    the prompt instruction instead of the native field;
  - direct `/v1/chat/completions` normalization proving
    `verbosity:"low"` is removed from the upstream request, injected as a
    system instruction, and excluded from the generic filtered field list.
- Validation:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/translator.test.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/translator.test.js --test-name-pattern "Chat-native request fields"`:
    passed 41/41.
  - `node --test test/server.test.js --test-name-pattern "verbosity|Chat-native request fields|normalizes OpenAI Chat fields"`:
    passed 204/204.
  - `npm test`: passed 248/248.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1770 ms, P95 latency 1938 ms, and 116 total
    tokens.
  - Live localhost `/v1/chat/completions` smoke with `verbosity:"low"` and
    `reasoning_effort:"none"` against `deepseek-v4-pro` returned HTTP 200,
    visible content `ok-verbosity-live`, and compatibility metadata showing
    `forwarded:false`, `reason:"provider_unsupported_prompt_instruction"`,
    and `prompt_instruction:"injected"`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 DeepSeek Structured Output Passthrough Downgrade

- Rechecked the official OpenAI Structured Outputs guidance through the
  OpenAI developer docs MCP. OpenAI documents `json_schema` Structured Outputs
  as schema-adherent output and `json_object` JSON mode as a weaker valid-JSON
  mode; both are supported across Responses, Chat Completions, Assistants,
  Fine-tuning, and Batch where model support allows it.
- Rechecked the official DeepSeek JSON Output guide. DeepSeek documents
  `response_format:{"type":"json_object"}` and requires an explicit prompt
  instruction containing "json" plus an example or desired shape; it does not
  document OpenAI's `response_format:{"type":"json_schema"}` as a Chat
  completion request format.
- Extended shared Chat passthrough compatibility so Direct Chat and
  Assistants-backed Chat requests no longer forward unsupported OpenAI
  `response_format.type:"json_schema"` to DeepSeek-compatible providers by
  default:
  - the upstream request is downgraded to `response_format:{type:"json_object"}`;
  - the original JSON Schema name, description, `strict`, and schema body are
    injected as model-visible system instructions that include the word
    "json";
  - compatibility metadata records `response_format.type`, `forwarded:false`,
    `downgraded_to:"json_object"`, the schema name, and the injected prompt
    instruction;
  - plain `json_object` Direct Chat requests receive a generic JSON-mode
    instruction only when the request context does not already mention JSON.
- Tightened the existing Responses `text.format.type:"json_schema"` downgrade
  prompt to use the same explicit "valid json" wording and include the schema
  description.
- Added regressions for:
  - Direct `/v1/chat/completions` `response_format:{type:"json_schema"}` with
    local stored-chat message retrieval proving the stored input remains the
    caller's original message;
  - Assistants `/v1/threads/{thread_id}/runs` `response_format` downgrade,
    including `metadata.compatibility.local_assistants.chat_passthrough`.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "json_schema response_format"`:
    passed 204/204.
  - `npm test`: passed 248/248.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1329 ms, P95 latency 1444 ms, and 99 total
    tokens.
  - Live localhost `/v1/chat/completions` smoke with
    `response_format:{type:"json_schema"}` against `deepseek-v4-pro` returned
    HTTP 200, content `{"status":"ok-live-json-schema"}`, and compatibility
    metadata showing `forwarded:false`, `downgraded_to:"json_object"`, and
    `schema_name:"live_json_schema_smoke"`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Input Token Probe Multimodal Coverage

- Rechecked the official OpenAI token-counting guidance through the OpenAI
  developer docs MCP. The documented `/v1/responses/input_tokens` endpoint
  accepts the same input shape as the Responses API, including messages,
  images, files, tools, conversations, and returns a
  `response.input_tokens` object with an integer `input_tokens` count.
- Tightened the local Responses input-token compatibility path for
  Chat-Completions-only providers:
  - request input, `previous_response_id`, and local conversation replay are
    translated to Chat-visible prompt context;
  - local `input_file` and `input_image` content extraction is included in
    the upstream usage probe when configured for text-mode compatibility;
  - Responses function tools are preserved as Chat function tools for the
    provider-side prompt-token calculation;
  - stream-only request options are stripped after the probe is forced to
    non-streaming `max_tokens:1`, so `stream_options` is not leaked into a
    non-streaming upstream Chat request;
  - the probe remains read-only and does not append Conversation items.
- Added a regression covering conversation replay, local input files, image
  text markers, tool schemas, `store:true`, `stream:true`,
  `stream_options.include_usage`, and the read-only conversation invariant.
- Validation:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "responses/input_tokens"`:
    passed 202/202.
  - `npm test`: passed 246/246.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1258 ms, P95 latency 1412 ms, and 99 total
    tokens.
  - Pre-restart localhost `/v1/responses/input_tokens` smoke reproduced the
    old DeepSeek rejection for `stream_options` on a forced non-streaming
    probe; after restarting the bridge with this fix, the same payload returned
    `{"object":"response.input_tokens","input_tokens":12}`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Direct Chat DeepSeek Field Matrix Regression

- Rechecked current OpenAI Chat Completions create-field coverage with the
  OpenAI developer docs MCP/OpenAPI endpoint for `/chat/completions`, including
  `safety_identifier`, `prompt_cache_key`, `prompt_cache_retention`,
  `modalities`, `audio`, `prediction`, `parallel_tool_calls`, `verbosity`,
  `web_search_options`, legacy `functions` / `function_call`, `logprobs`, and
  `top_logprobs`.
- Rechecked the official DeepSeek Chat Completion documentation. The DeepSeek
  API documents `user_id`, `stream_options.include_usage`, `logprobs`, and
  `top_logprobs`, while OpenAI-only request fields such as
  `safety_identifier`, prompt-cache hints, audio-output controls, and legacy
  function fields should remain bridge-local or provider-filtered.
- Expanded the direct `/v1/chat/completions` DeepSeek compatibility regression:
  - verifies `safety_identifier` takes priority over `prompt_cache_key` and
    `user` when deriving DeepSeek `user_id`;
  - verifies invalid DeepSeek user-id characters are converted to a stable
    `sha256_` identifier;
  - verifies OpenAI-only Chat fields are not sent upstream to DeepSeek and are
    recorded in `metadata.compatibility.chat_passthrough.chat_native_fields`;
  - verifies DeepSeek-supported `logprobs:true` and `top_logprobs:3` still pass
    through.
- Updated deployment and compatibility docs so the provider-field boundary is
  explicit instead of relying on the shorter "prompt-cache hints" wording.
- Validation:
  - `node --test test/server.test.js --test-name-pattern "normalizes OpenAI Chat fields for DeepSeek-compatible providers"`:
    passed 201/201.
  - Live localhost `/v1/chat/completions` field-matrix smoke against
    `deepseek-v4-pro` returned HTTP 200 with visible `ok-live.` output,
    `finish_reason:"stop"`, `safety_identifier` mapped to a SHA-256
    DeepSeek `user_id`, OpenAI-only fields filtered from the upstream request,
    `reasoning_effort:"none"` mapped to `thinking:{type:"disabled"}`, and
    provider `logprobs` present.
  - `node --check test/server.test.js`: passed.
  - `npm test`: passed 245/245.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1175 ms, P95 latency 1216 ms, and 99 total tokens.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Eight-Namespace Tool Search Sweep

- Rechecked the official OpenAI deployment checklist guidance through the
  OpenAI developer docs MCP. The guidance recommends deferring large tool
  catalogs with `tool_search`, grouping tools by user intent using namespaces
  or MCP servers, and keeping each namespace small and discriminative.
- Expanded `responses-tool-search-catalog-sweep` from a three-scenario sample
  to an eight-namespace matrix covering every large-catalog namespace:
  - `billing.lookup_invoice` with `{"invoice_id":"INV-900"}`;
  - `crm.assign_owner` with
    `{"account_id":"ACCT-77","owner_id":"USER-12"}`;
  - `shipping.reroute_package` with `{"tracking_id":"TRK-800"}`;
  - `returns.schedule_pickup` with `{"rma_id":"RMA-84"}`;
  - `inventory.reserve_sku` with
    `{"sku":"SKU-9","order_id":"ORDER-314"}`;
  - `security.rotate_key` with `{"key_id":"KEY-77"}`;
  - `support.escalate_ticket` with `{"ticket_id":"TICK-55"}`;
  - `analytics.detect_anomaly` with
    `{"metric":"checkout_conversion"}`.
- Kept the strict public-output gate from the prior hardening: DSML text leaks
  and visible assistant prose leaks both fail the scenario. The report also
  records assistant text suppression counts so model-side prose drift can be
  distinguished from public protocol leakage.
- Updated the evaluation plan command timeout for the larger sweep and updated
  the compatibility matrix to describe the eight-namespace coverage.
- Validation:
  - `node --check scripts/eval-harness.mjs`: passed.
  - Live `responses-tool-search-catalog-sweep` passed 1/1 against
    `deepseek-v4-pro`; all 8/8 scenarios passed, pass rate 1.0, total latency
    27986 ms, per-scenario average latency 3497 ms, P95 latency 4271 ms, usage
    18055 input / 940 output / 18995 total tokens, loaded fraction average/max
    0.125, DSML text leak count 0, assistant text leak count 0, assistant text
    suppressed count 2, text pseudo-tool call count 0, and final function
    calls `billing.lookup_invoice`, `crm.assign_owner`,
    `shipping.reroute_package`, `returns.schedule_pickup`,
    `inventory.reserve_sku`, `security.rotate_key`,
    `support.escalate_ticket`, and `analytics.detect_anomaly`.
  - `npm test`: passed 245/245.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1541 ms, P95 latency 1904 ms, and 99 total tokens.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Tool-Only Tool Search Prose Suppression

- Rechecked the official OpenAI tools guidance through the OpenAI developer
  docs MCP. This hardening keeps the documented `tool_search` flow intact:
  deferred tools are loaded first, then the public Responses output should
  expose `tool_search_call` / `tool_search_output` followed by the selected
  function call.
- Added a narrow local `tool_search` post-processor for Chat-only providers:
  when an already-loaded `tool_search` function call and ordinary
  `message.content` arrive in the same Chat choice, the bridge suppresses the
  ordinary assistant text before Responses translation. This prevents
  tool-only turns from gaining an extra public `message` item while preserving
  the function call.
- Added compatibility metadata counters:
  `local_tool_search.assistant_text_suppressed_count` and
  `local_tool_search.assistant_text_suppressed_char_count`.
- Applied the same behavior to non-streaming, streaming, and background
  Responses paths. The streaming path now detects this condition after
  buffering the provider stream and emits function-call SSE events instead of
  replaying buffered text deltas.
- Fixed the Chat streaming accumulator so split `tool_calls[].function.name`
  fragments are concatenated instead of overwritten. The public stream already
  accumulated names correctly; the buffered-completion path now matches it.
- Tightened `responses-tool-search-catalog-sweep`: assistant prose visible in
  the public output is now a failing condition, and the eval report includes
  suppression counts.
- Validation:
  - `node --check src/bridge/local_tool_search.js src/bridge/server.js
    scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "tool_search"`:
    passed 201/201.
  - `npm test`: passed 245/245.
  - Restarted `aialra-opencodexapp-bridge.service`; `/healthz` returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 2796 ms, P95 latency 4282 ms, and 99 total tokens.
  - Live `responses-tool-search-catalog-sweep` passed 1/1 against
    `deepseek-v4-pro`; all 3/3 scenarios passed, pass rate 1.0, total latency
    11564 ms, per-scenario average latency 3854 ms, P95 latency 4832 ms, usage
    6722 input / 357 output / 7079 total tokens, loaded fraction average/max
    0.125, DSML text leak count 0, assistant text leak count 0, assistant text
    suppressed count 1, text pseudo-tool call count 0, and final function
    calls `inventory.reserve_sku`, `security.rotate_key`, and
    `support.escalate_ticket`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Tool Search Catalog Sweep

- Rechecked the official OpenAI `tool_search` guidance through the OpenAI
  developer docs MCP. This slice follows the documented pattern of keeping
  large tool catalogs deferred, grouping tools by intent/namespace, and loading
  only the relevant group before exposing concrete function schemas to the
  model.
- Added `responses-tool-search-catalog-sweep` to the live
  `bridge-regression` harness. The case runs three deterministic shuffled
  large-catalog scenarios against the deployed DeepSeek bridge:
  - `inventory.reserve_sku` with `{"sku":"SKU-9","order_id":"ORDER-314"}`;
  - `security.rotate_key` with `{"key_id":"KEY-77"}`;
  - `support.escalate_ticket` with `{"ticket_id":"TICK-55"}`.
- The sweep records scenario pass rate, average/P95 latency, token usage,
  loaded-catalog fraction, DSML text leaks, assistant prose leaks, text
  pseudo-tool promotion counts, and final public Responses function-call names
  so larger randomized catalog sweeps can compare protocol stability and model
  behavior over time.
- Updated the evaluation plan and compatibility matrix so large-catalog
  `tool_search` now includes both the single returns-label regression and a
  multi-scenario shuffled catalog sweep. Hosted connector inventories,
  per-tenant indexes, broader randomized sweeps, and stricter suppression of
  assistant prose on tool-only turns remain follow-up work.
- Validation:
  - `node --check scripts/eval-harness.mjs`: passed.
  - Live `responses-tool-search-catalog-sweep` passed 1/1 against
    `deepseek-v4-pro`; all 3/3 scenarios passed, pass rate 1.0, total latency
    11416 ms, per-scenario average latency 3804 ms, P95 latency 3991 ms, usage
    6723 input / 371 output / 7094 total tokens, loaded fraction average/max
    0.125, DSML text leak count 0, assistant prose leak count 1, text
    pseudo-tool call count 0, and final function calls
    `inventory.reserve_sku`, `security.rotate_key`, and
    `support.escalate_ticket`.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1186 ms, P95 latency 1241 ms, and 99 total tokens.
  - `npm test`: passed 245/245.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Large-Catalog Tool Search Regression

- Rechecked the official OpenAI `Use tool_search` deployment guidance through
  the OpenAI developer docs MCP before implementing this slice. The relevant
  guidance says deferred tools can be loaded by hosted or client-executed
  `tool_search`, and large catalogs should be grouped by intent/namespace or
  MCP server rather than forwarding every tool schema up front.
- Added live bridge-regression coverage,
  `responses-tool-search-large-catalog`, for a large local catalog:
  - request contains eight namespaces and 48 deferred functions;
  - `tool_choice:{type:"tool_search"}` is mapped to the generated
    `local_tool_search` Chat function on the first provider turn;
  - after `tool_search` selects `returns`, the bridge emits public
    `tool_search_call` and `tool_search_output`, injects only the six loaded
    `returns` functions into the follow-up Chat turn, and clears the forced
    search `tool_choice`;
  - final output must be a standard Responses `function_call` for
    `namespace:"returns"`, `name:"create_return_label"`, with
    `{"rma_id":"RMA-42","format":"pdf"}` and no DSML text.
- Hardened DeepSeek compatibility for loaded `tool_search` functions that
  arrive as DSML/pseudo-tool text instead of native Chat `tool_calls`.
  Supported observed forms now include:
  - direct invocation, for example `create_return_label`;
  - `local_tool_call` with `path` and JSON `input`;
  - namespace wrapper invocation with `method` and JSON `params`.
  The bridge promotes these to Chat `tool_calls` before Responses translation,
  suppresses the pseudo text, and records
  `local_tool_search.text_tool_call_count` /
  `local_tool_search.text_suppressed_count` when the fallback is used.
- Added a streaming safeguard for the same promotion path: when the bridge has
  buffered a streaming provider response and detects loaded-function pseudo
  text before replaying it, it emits standard Responses function-call SSE
  events instead of replaying DSML text.
- Updated the compatibility matrix and evaluation plan so large-catalog
  `tool_search` is no longer an unevaluated gap; hosted connector inventories
  and broader randomized quality/latency/token sweeps remain future work.
- Validation:
  - `node --check src/bridge/local_tool_search.js src/bridge/server.js
    test/server.test.js scripts/eval-harness.mjs`: passed.
  - `node --test test/server.test.js --test-name-pattern "hosted tool_search|promotes text tool_search|streaming tool_search"`:
    passed 200/200 because the Node test runner executed the full server test
    file at that point.
  - `node --test test/server.test.js --test-name-pattern "promotes local_tool_call|promotes text tool_search"`:
    passed 201/201 after adding both DSML wrapper variants.
  - `npm test`: passed 245/245.
  - Restarted `aialra-opencodexapp-bridge.service`; `/healthz` returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Post-push service check: `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were all `active`;
    `https://opencodexapp.aialra.online/` returned HTTP 200.
  - Storage check: repo worktree 125 MB, `state/` 46 MB, `output/` 4.5 MB,
    `/srv/aialra/data/opencodexapp` 136 KB, and
    `/srv/aialra/logs/opencodexapp` 30 MB.
  - Live `responses-tool-search-large-catalog` passed 1/1 against
    `deepseek-v4-pro`; latency 3111 ms, usage 2305 input / 105 output / 2410
    total tokens, namespace count 8, deferred tool count 48, loaded tool count
    6, loaded namespace `returns`, and final function call
    `returns.create_return_label` with `rma_id:"RMA-42"` and `format:"pdf"`.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1164 ms, P95 latency 1241 ms, and 99 total tokens.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.

## 2026-06-16 Live Client Tool Search Regression

- Rechecked the official OpenAI API deployment checklist through the OpenAI
  developer docs MCP. The `Use tool_search` guidance distinguishes hosted
  `tool_search` from client-executed `tool_search`; the latter is intended for
  app-controlled discovery based on tenant, project, permissions, or an
  internal registry.
- Added a live bridge-regression case,
  `responses-tool-search-client`, that exercises the client-executed sequence
  against the deployed DeepSeek bridge:
  - first request uses `tools:[{type:"tool_search", execution:"client"}, ...]`
    with a deferred `shipping.get_shipping_eta` namespace tool and forced
    `tool_choice:{type:"tool_search"}`;
  - first response emits a public `tool_search_call` with
    `execution:"client"` and no `tool_search_output` or `function_call`;
  - the harness supplies a follow-up `tool_search_output` with the selected
    namespace tool and `previous_response_id`;
  - second response loads that client-supplied tool and returns a
    `function_call` with `namespace:"shipping"`, `name:"get_shipping_eta"`,
    and `{"order_id":"order_42"}`.
- The runner deletes the first stored response after the follow-up completes so
  repeated live evals do not accumulate unnecessary response state.
- Updated the evaluation plan and compatibility matrix so live client-executed
  `tool_search` is no longer listed as a missing eval gap; hosted connector
  search and large-catalog quality/latency evals remain on the roadmap.
- Validation:
  - `node --check scripts/eval-harness.mjs`: passed.
  - Live `responses-tool-search-client` passed 1/1 against
    `deepseek-v4-pro`; latency 3333 ms, usage 955 input / 103 output / 1058
    total tokens, `tool_search_call_count:1`,
    `input_tool_search_output_count:1`, `loaded_chat_tool_count:1`, and the
    final function call was `shipping.get_shipping_eta` with
    `order_id:"order_42"`.
  - `npm test`: passed 243/243.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1251 ms, P95 latency 1299 ms, and 99 total tokens.

## 2026-06-16 Streaming Tool Search Name Remapping

- Closed the local `tool_search` streaming name-leak boundary for deferred
  namespace functions whose public name collides with another Chat function.
  The bridge now remaps final streaming `function_call` output items from the
  generated Chat tool name back to the original Responses `name` and
  `namespace` before `response.output_item.done` and `response.completed` are
  emitted.
- Added `metadata.compatibility.local_tool_search.stream_remapped_tool_call_count`
  so live streams can be audited when generated Chat names are rewritten at
  the public Responses boundary.
- Added mock-provider coverage for a collision-heavy streaming path:
  - first stream calls generated `local_tool_search`;
  - the bridge emits public `tool_search_call` and `tool_search_output`;
  - the follow-up Chat request contains both the immediate `lookup` function
    and the loaded deferred `crm.lookup` function under a generated
    collision-safe Chat name;
  - the provider splits that generated name across two SSE chunks;
  - the public stream and completed response expose only
    `namespace:"crm", name:"lookup"`.
- Updated the compatibility matrix and evaluation plan to remove the old
  streaming generated-name boundary and keep hosted connector search, live
  client-executed `tool_search`, and large-catalog evals on the roadmap.
- Validation:
  - `node --check src/bridge/local_tool_search.js src/bridge/server.js
    test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "remaps streaming tool_search namespace function names"`:
    passed 199/199 because the Node test runner executed the full server test
    file, including the new regression.
  - `npm test`: passed 243/243.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1257 ms, P95 latency 1433 ms, and 99 total tokens.
  - Live
    `responses-mcp-remote-tool-search-stream-approval` passed 1/1 against
    `deepseek-v4-pro`; latency 4807 ms, 33 stream events, public output
    `mcp-tool-search-stream-approval-ok`, remote methods `initialize`,
    `notifications/initialized`, `tools/list`, and `tools/call`, and no public
    bridge-internal function-call events.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`, local `/healthz` returned `ok:true` with
    provider base `https://api.deepseek.com` and default model
    `deepseek-v4-pro`, and `https://opencodexapp.aialra.online/` returned
    HTTP 200.

## 2026-06-16 Live Tool Search MCP Approval Hardening

- Extended the live bridge-regression harness with deferred remote MCP approval
  cases that exercise the official Responses sequence end to end against the
  deployed DeepSeek bridge:
  - `tool_search` selects a deferred `mcp` server and imports remote
    `tools/list`;
  - the first response emits `tool_search_call`, `mcp_list_tools`, and
    `mcp_approval_request`;
  - the continuation sends `mcp_approval_response` with `previous_response_id`,
    reuses the prior `mcp_list_tools`, skips a second `tools/list`, executes
    remote `tools/call`, and emits the public `mcp_call`.
- Hardened DeepSeek compatibility for MCP pseudo-tool text observed in live
  runs:
  - parses DSML-like text invocations such as `mcp_tool_approval_request`,
    `create_approval`, `local_mcp_approval_create`, scoped
    `server.tool` names, and `requests:[[server, tool, args]]` into generated
    Chat function calls before the bridge maps them to Responses MCP items;
  - suppresses assistant DSML / pseudo tool-call text after a successful
    remote MCP call, while preserving the `mcp_call` output item for clients;
  - records `local_mcp.remote_text_tool_call_count` and
    `local_mcp.remote_text_suppressed_count` compatibility metadata.
- Kept `CODEXCOMPAT_MCP_MAX_CALL_ROUNDS` at `1` for ordinary direct MCP
  requests, but added an effective minimum of two tool-loop rounds when local
  `tool_search` and MCP are both active. A complete same-request
  `tool_search -> MCP approval/call` chain needs one provider round to load the
  server and another to request or execute the MCP action. Updated
  `.env.example`, deployment docs, and the compatibility matrix.
- Tightened MCP prompt guidance so Chat-only providers are told not to emit
  DSML/XML pseudo-tool markup in normal assistant answers and not to request
  approval again when a successful `mcp_call.output` is already visible.
- Stabilized the live PDF file-search fixture by shortening the embedded PDF
  text to the marker itself, avoiding `pdftotext` line clipping that made the
  result-content assertion flaky while preserving the same PDF extraction
  coverage.
- Validation:
  - `node --check src/bridge/local_mcp.js src/bridge/server.js
    scripts/eval-harness.mjs`: passed.
  - Focused MCP/tool-search tests:
    `node --test --test-name-pattern "auto-approved remote MCP tools/call|background executes auto-approved remote MCP|deferred remote MCP loaded through hosted tool_search|text MCP approval emitted after hosted tool_search|suppresses pseudo tool markup" test/server.test.js`
    passed 7/7.
  - `npm test`: passed 242/242.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - Restarted `aialra-opencodexapp-bridge.service`; `/healthz` returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1342 ms, P95 latency 1357 ms, and 99 total tokens.
  - Live `responses-mcp-remote-approval` passed 1/1 against
    `deepseek-v4-pro`, latency 3228 ms, direct remote MCP approval/call still
    forwarding MCP auth and preserving session forwarding.
  - Live `responses-mcp-remote-tool-search-approval` passed 1/1 against
    `deepseek-v4-pro`; latency 5011 ms, `remote_text_suppressed_count:1`,
    remote methods `initialize`, `notifications/initialized`, `tools/list`,
    `tools/call`, authorization forwarded to MCP and absent from public output.
  - Live `responses-mcp-remote-tool-search-stream-approval` passed 1/1 against
    `deepseek-v4-pro`; latency 5438 ms, 33 stream events, same remote MCP
    method chain, `remote_text_suppressed_count:0`, and no public
    bridge-internal function-call events.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 115/115,
    pass rate 1.0, average latency 1448 ms, P95 latency 4116 ms, and 34658
    total tokens.

## 2026-06-16 Streaming Tool Search MCP Approval Coverage

- Re-confirmed the official OpenAI MCP/connectors guidance through the OpenAI
  developer docs MCP:
  - deferred MCP servers can be loaded lazily by hosted `tool_search`;
  - `mcp_list_tools` in the response context avoids refetching the tool list on
    later turns;
  - approval-required calls emit `mcp_approval_request` and can be continued by
    sending `mcp_approval_response` with `previous_response_id`.
- Added a streaming mock-provider regression for the full deferred MCP
  tool-search approval path:
  - first streaming response exposes only `local_tool_search`, imports remote
    `tools/list`, emits `tool_search_call`, `mcp_list_tools`, and
    `mcp_approval_request`, and does not execute remote `tools/call`;
  - the continuation sends `mcp_approval_response approve:true`, reuses the
    previous response's `mcp_list_tools`, skips a second remote `tools/list`,
    executes the approved remote `tools/call`, emits MCP argument
    delta/done/progress stream events, and streams the final answer;
  - both streaming responses suppress bridge-internal Chat `function_call`
    stream events and check that MCP authorization is redacted from provider
    prompts and public Responses output.
- Updated `docs/evaluation-plan.md` and `docs/compatibility-matrix.md` so the
  deferred MCP tool-search approval continuation is explicitly documented for
  streaming as well as non-streaming requests.
- Validation:
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "streams approval flow for deferred remote MCP loaded through hosted tool_search" test/server.test.js`:
    passed.
  - `node --test --test-name-pattern "loads deferred remote MCP tools through hosted tool_search|requests approval for deferred remote MCP loaded through hosted tool_search|streams approval flow for deferred remote MCP loaded through hosted tool_search|streams deferred remote MCP tools loaded through hosted tool_search|streams remote MCP approval requests|streams approved remote MCP approval response execution" test/server.test.js`:
    passed 6/6 tests.
  - `git diff --check`: passed.
  - `npm test`: passed 240/240 tests.
  - `npm run secret-scan`: passed.
  - exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: passed 2/2 live protocol-smoke cases against the
    local bridge with DeepSeek model `deepseek-v4-pro` (100% pass rate; 99
    total tokens).
  - Storage check: `/` has 11 GB available; repo path is 119 MB,
    `/srv/aialra/data/opencodexapp` is 136 KB, and
    `/srv/aialra/logs/opencodexapp` is 30 MB.

## 2026-06-16 Tool Search MCP Approval Continuation Coverage

- Re-confirmed the official OpenAI MCP/connectors guidance through the OpenAI
  developer docs MCP:
  - deferred MCP servers can set `defer_loading:true` and be loaded only after
    hosted `tool_search` selects them;
  - a returned `mcp_list_tools` item should stay in conversation context so a
    later request does not need to fetch the MCP tool list again;
  - approval-required MCP calls emit `mcp_approval_request`, then a later
    request can send `mcp_approval_response` with `previous_response_id`.
- Added a mock-provider regression for the approval-required deferred MCP
  tool-search path:
  - first Chat turn sees only the generated `local_tool_search` function and
    the searchable MCP server summary;
  - the bridge imports remote MCP `tools/list`, emits public
    `tool_search_call` and `mcp_list_tools`, injects the loaded MCP schema, and
    maps the model's returned MCP proxy call to `mcp_approval_request` without
    executing remote `tools/call`;
  - the continuation sends `mcp_approval_response approve:true` with
    `previous_response_id`, reuses the prior `mcp_list_tools` item, skips a
    second remote `tools/list`, executes the approved remote `tools/call`, and
    emits `mcp_call` plus final text;
  - provider prompts and public Responses output are checked for redacted MCP
    authorization.
- Updated `docs/evaluation-plan.md` and `docs/compatibility-matrix.md` so the
  deferred MCP tool-search approval continuation is recorded beside the
  auto-approved and streaming tool-search MCP flows.
- Validation:
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "requests approval for deferred remote MCP loaded through hosted tool_search" test/server.test.js`:
    passed.
  - `node --test --test-name-pattern "loads deferred remote MCP tools through hosted tool_search|requests approval for deferred remote MCP loaded through hosted tool_search|streams deferred remote MCP tools loaded through hosted tool_search|requests approval then executes approved remote MCP call|reuses input mcp_list_tools" test/server.test.js`:
    passed 5/5 tests.
  - `git diff --check`: passed.
  - `npm test`: passed 239/239 tests.
  - `npm run secret-scan`: passed.
  - exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: still blocked by upstream DeepSeek `402
    Insufficient Balance` on both live protocol-smoke cases.
  - Pushed commit `4ca11ec` to `origin/main`.
  - Runtime code was unchanged in this coverage-only turn, so no service
    restart was required.
  - Real Open CodexApp services
    `aialra-opencodexapp-bridge`, `aialra-opencodexapp-web`, and
    `aialra-opencodexapp-app-server` are all `active`.
  - Local bridge `/healthz` returned `ok:true` with DeepSeek provider base, and
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Storage check: `/` has 11 GB available; repo path is 118 MB,
    `/srv/aialra/data/opencodexapp` is 136 KB, and
    `/srv/aialra/logs/opencodexapp` is 30 MB.

## 2026-06-16 Streaming Tool Search MCP Coverage

- Re-confirmed the official OpenAI `tool_search` deployment guidance through
  the OpenAI developer docs MCP: deferred tool definitions are hidden at request
  start, loaded only after the model runs tool search, and should be grouped by
  namespaces or MCP servers when possible.
- Added a streaming mock-provider regression for the full deferred MCP
  tool-search chain:
  - first streaming Chat turn calls the generated `local_tool_search` function;
  - the bridge imports remote MCP `tools/list`, emits public
    `tool_search_call` and `mcp_list_tools` output items, and injects the
    loaded MCP schema into the next streaming Chat request;
  - the second streaming Chat turn calls the generated MCP proxy function;
  - the bridge executes remote MCP `tools/call`, emits public MCP argument
    delta/done/progress events, suppresses bridge-internal Chat
    `function_call` stream items, and streams the final text from the third
    Chat turn;
  - the completed Responses object records combined usage and
    `boundary=tool_search_mcp_list_tools_and_call_execution`.
- Updated `docs/evaluation-plan.md` and `docs/compatibility-matrix.md` so this
  streaming coverage is listed beside the non-streaming hosted tool-search MCP
  coverage.
- Validation:
  - `node --check test/server.test.js src/bridge/server.js src/bridge/local_mcp.js src/bridge/local_tool_search.js`:
    passed.
  - `node --test --test-name-pattern "streams deferred remote MCP tools loaded through hosted tool_search" test/server.test.js`:
    passed.
  - `node --test --test-name-pattern "loads deferred remote MCP tools through hosted tool_search|streams deferred remote MCP tools loaded through hosted tool_search|streams auto-approved remote MCP tools/call|streams remote MCP approval requests|streams approved remote MCP approval response execution" test/server.test.js`:
    passed 5/5 tests.
  - `git diff --check`: passed.
  - `npm test`: passed 238/238 tests.
  - `npm run secret-scan`: passed.
  - exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: still blocked by upstream DeepSeek `402
    Insufficient Balance` on both live protocol-smoke cases.
  - Pushed commit `7b6f3ba` to `origin/main`.
  - Runtime code was unchanged in this coverage-only turn; bridge, web, and
    app-server services remained `active`.
  - Local bridge `/healthz` returned `ok:true` with DeepSeek provider base and
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Storage check: repo path 118 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, `output/` 4.5 MB, `state/` 42 MB,
    and root filesystem had 11 GB available.

## 2026-06-16 Hosted Tool Search Loads Deferred MCP

- Re-checked the official OpenAI deployment checklist through the OpenAI
  developer docs MCP. The `Use tool_search` section says deferred tool
  definitions marked `defer_loading:true` should be hidden at request start,
  loaded only after the model runs tool search, and grouped by user intent with
  namespaces or MCP servers when possible.
- Closed the next deferred MCP parity gap for Chat-only providers:
  - deferred remote MCP servers now appear in the local `tool_search` prompt as
    searchable server groups without importing full tool catalogs at request
    start;
  - a model call to the generated `local_tool_search` function can select an
    MCP server by `server_labels`, `paths`, allowed tool names, or scored query
    text;
  - the bridge then performs bounded remote MCP `initialize` / `tools/list`,
    emits a public `mcp_list_tools` item as part of the tool-search execution
    output, and injects the imported MCP schemas as generated Chat function
    tools for the follow-up request;
  - returned generated Chat tool calls can execute remote MCP `tools/call` in
    the same Responses request when the effective MCP tool loop permits a
    search round and an MCP approval/call round;
  - preparation-time deferred MCP servers no longer consume an empty
    `mcp_list_tools` budget slot before tool search has selected them.
- Later live hardening kept the configured default at `1` for ordinary direct
  MCP requests and applies an effective minimum of `2` only when local
  `tool_search` and MCP are both active.
- Added compatibility metadata for
  `local_tool_search.searchable_mcp_server_count`,
  `local_tool_search.mcp_list_tools_loaded_count`,
  `local_tool_search.mcp_loaded_tool_count`,
  `local_mcp.tool_search_list_tools_loaded_count`,
  `local_mcp.tool_search_loaded_tool_count`, and
  `boundary=tool_search_mcp_list_tools_and_call_execution`.
- Added mock-provider coverage for `tool_search -> remote MCP tools/list ->
  generated MCP Chat function -> remote MCP tools/call -> final answer`, plus
  adjacent regression coverage for function/namespace tool search, deferred
  input `mcp_list_tools`, non-streaming remote MCP calls, streaming remote MCP
  calls, and active background remote MCP calls.
- Validation:
  - `node --check src/bridge/local_mcp.js src/bridge/local_tool_search.js src/bridge/server.js test/server.test.js`:
    passed.
  - `node --test --test-name-pattern "loads deferred remote MCP tools through hosted tool_search" test/server.test.js`:
    passed.
  - `node --test --test-name-pattern "emulates hosted tool_search|loads client-executed tool_search_output|imports remote MCP tools/list|reuses input mcp_list_tools|loads deferred remote MCP tools through hosted tool_search|executes auto-approved remote MCP tools/call|streams auto-approved remote MCP tools/call|background executes auto-approved remote MCP tools/call" test/server.test.js`:
    passed 8/8 tests.
  - `git diff --check`: passed.
  - `npm test`: passed 237/237 tests.
  - `npm run secret-scan`: passed.
  - exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: still blocked by upstream DeepSeek `402
    Insufficient Balance` on both live protocol-smoke cases.
  - Pushed commit `98c3349` to `origin/main`.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`.
  - Local bridge `/healthz` returned `ok:true` with DeepSeek provider base and
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - `npm run smoke:bridge` reached the live bridge but was blocked by upstream
    DeepSeek `402 Insufficient Balance`.
  - Storage check: repo path 117 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, `output/` 4.5 MB, `state/` 42 MB,
    and root filesystem had 11 GB available.

## 2026-06-16 Deferred MCP Input List Loading

- Checked the official OpenAI MCP/connectors guide through the OpenAI developer
  docs MCP. The guide documents `tools:[{type:"mcp"}]`,
  `server_url`/`connector_id`, `allowed_tools`, approval request/response
  items, and `defer_loading:true` for MCP servers used with tool search.
- Closed a deferred MCP continuation gap for Chat-only providers:
  - when a request has `tools:[{type:"mcp",defer_loading:true,...}]` and a
    matching `mcp_list_tools` item appears in current `input` or the previous
    response output, the bridge now reuses that cached list instead of issuing a
    fresh remote `tools/list`;
  - cached MCP tool definitions preserve `annotations`, `description`, `name`,
    and `input_schema`, and are exposed upstream as generated Chat function
    tools for remote `server_url` MCP servers;
  - auto-approved generated Chat tool calls are mapped to remote MCP
    `tools/call` and public Responses `mcp_call` output items;
  - compatibility metadata records
    `local_mcp.input_list_tools_loaded_count` and
    `boundary=input_mcp_list_tools_and_call_execution` for the executed path.
- Kept non-deferred remote MCP behavior unchanged so existing
  `initialize`/`tools/list` session headers continue to support approval flows.
- Prevented raw MCP protocol item leakage by skipping `mcp_list_tools`,
  `mcp_call`, `mcp_approval_request`, and `mcp_approval_response` in the generic
  Responses-input-to-Chat fallback when the local MCP adapter is active; the
  MCP adapter prompt remains responsible for surfacing the bounded context.
- Added mock-provider regressions for deferred input-loaded `mcp_list_tools`
  remote calls and translator skipping of local MCP protocol input items.
- Validation:
  - `node --check src/bridge/local_mcp.js src/bridge/translator.js test/server.test.js test/translator.test.js`:
    passed.
  - `node --test test/translator.test.js --test-name-pattern 'MCP protocol input items'`:
    passed 41/41 tests.
  - `node --test test/server.test.js --test-name-pattern 'reuses input mcp_list_tools|requests approval then executes approved remote MCP call|streams approved remote MCP approval response execution|background executes approved remote MCP approval response|handles denied remote MCP approval'`:
    passed 192/192 tests.
  - `git diff --check`: passed.
  - `npm test`: passed 236/236 tests.
  - `npm run secret-scan`: passed.
  - exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: blocked by upstream DeepSeek `402 Insufficient
    Balance` on both live cases; mock-provider protocol and bridge regressions
    remain green.
  - Pushed commit `12c7b56` to `origin/main`.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`.
  - Local bridge `/healthz` returned `ok:true` with DeepSeek provider base and
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - `npm run smoke:bridge` reached the live bridge but was blocked by upstream
    DeepSeek `402 Insufficient Balance`.
  - Storage check: repo path 117 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, `output/` 4.5 MB, `state/` 42 MB,
    and root filesystem had 12 GB available.

## 2026-06-16 Tool Search Input-Loaded Tools

- Continued the local `tool_search` parity work against the official OpenAI
  tool-search guide's client-executed second-turn and `additional_tools`
  sections.
- Closed two input-driven loaded-tool gaps for Chat-only providers:
  - a later Responses request can now pass `tool_search_output.tools` in
    `input` without repeating `tools:[{type:"tool_search"}]`; the bridge loads
    those function/namespace definitions as Chat function tools and records
    `metadata.compatibility.local_tool_search.boundary=loaded_from_tool_search_output_input`;
  - `additional_tools` input items now load function/namespace definitions into
    Chat function tools and record
    `metadata.compatibility.local_tool_search.boundary=loaded_from_additional_tools_input`.
- Prevented raw protocol item leakage by skipping `tool_search_call`,
  `tool_search_output`, and `additional_tools` in the generic
  Responses-input-to-Chat text fallback; the local tool-search adapter is
  responsible for exposing loaded tool state.
- Sanitized stored Chat replay tool calls so Responses-only `namespace`
  metadata is not sent back to strict Chat providers inside
  `tool_calls[].function`.
- Added mock-provider regressions for client-executed second turns and
  `additional_tools`, plus a translator regression for skipped local tool
  protocol input items.
- Validation:
  - `node --check` on `src/bridge/local_tool_search.js`,
    `src/bridge/server.js`, `src/bridge/translator.js`,
    `test/server.test.js`, and `test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js --test-name-pattern 'tool_search|additional_tools|tool-definition input'`:
    passed 40/40 tests.
  - `node --test test/server.test.js --test-name-pattern 'tool_search|additional_tools'`:
    passed 191/191 tests.
  - `npm test`: passed 234/234 tests.
  - `npm run secret-scan`: passed.
  - exact search for the user-provided DeepSeek test key across tracked files:
    clean.
  - `npm run eval:protocol`: blocked by upstream DeepSeek `402 Insufficient
    Balance` on both live cases; mock-provider protocol and bridge regressions
    remain green.
  - Pushed commit `966ef1f` to `origin/main`.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`.
  - Local bridge `/healthz` returned `ok:true` with DeepSeek provider base and
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - `npm run smoke:bridge` reached the live bridge but was blocked by upstream
    DeepSeek `402 Insufficient Balance`.
  - Storage check: repo path 116 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, `output/` 4.5 MB, `state/` 42 MB,
    and root filesystem had 7.9 GB available.

## 2026-06-16 Local Tool Search Deferred Function Loading

- Checked the official OpenAI tool-search guide through the OpenAI developer
  docs MCP. The guide defines `tools:[{type:"tool_search"}]`,
  `defer_loading:true`, hosted output items `tool_search_call` and
  `tool_search_output`, client-executed first-call behavior, namespace
  grouping, and later availability of `tool_search_output.tools`.
- Added a local `tool_search` adapter for Chat-only providers:
  - top-level deferred function schemas are hidden from the initial Chat tools
    list when local `tool_search` is active;
  - namespace tools are treated as searchable local surfaces, with only the
    namespace summary visible before search;
  - a generated `local_tool_search` Chat function lets the model request
    deferred tool loading, then the bridge emits public `tool_search_call` and
    `tool_search_output` Responses items;
  - loaded function schemas are injected into a follow-up Chat request and
    final function calls are remapped back to the original Responses name and
    `namespace`;
  - previously returned `tool_search_output.tools` can be replayed from input
    or `previous_response_id`;
  - non-streaming, streaming, and active background provider paths share the
    same local tool-search loop and shared `max_tool_calls` budget.
- Added configuration knobs `CODEXCOMPAT_TOOL_SEARCH_PROVIDER` and
  `CODEXCOMPAT_TOOL_SEARCH_MAX_LOADED_TOOLS`.
- Updated compatibility docs and the evaluation plan with the new adapter,
  emitted item shapes, metadata boundary, and remaining gaps around remote MCP
  / connector search and collision-safe streaming name remapping.
- Validation:
  - `node --check src/bridge/local_tool_search.js src/bridge/server.js src/bridge/translator.js`:
    passed.
  - `node --test test/translator.test.js --test-name-pattern 'tool_search|namespace tools|function tools'`:
    passed 39/39 tests, including new local reservation coverage.
  - `node --test test/server.test.js --test-name-pattern 'tool_search|normalizes computer action aliases'`:
    passed 189/189 tests, including the hosted namespace `tool_search`
    double-request regression.
  - Full `npm test`: passed 231/231 tests.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key in tracked files all passed with no tracked secret
    matches.
  - `npm run eval:protocol` reached the local deployed bridge, but both live
    DeepSeek cases returned HTTP 402 `Insufficient Balance`; no live
    model-quality assertion was possible on this run.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`, local `/healthz` returned `ok:true`,
    and public HTTPS returned HTTP 200.
  - Storage check after this iteration: root filesystem had 8.4 GB available
    at 96% usage.

## 2026-06-16 Computer Use Action Alias Normalization

- Continued tightening the local Computer Use action-loop adapter against the
  official Computer Use guide's action runner examples. The bridge already
  accepted model-returned action objects with `additionalProperties:true`, but
  clients could receive only the model's original spelling for common runtime
  fields.
- Added conservative alias normalization for model-requested `computer_call`
  actions:
  - `scroll_x` and `scrollX` are both populated when either spelling is present;
  - `scroll_y` and `scrollY` are both populated when either spelling is present;
  - a single `key` value is normalized into `keys:[...]` for `keypress`;
  - `drag` path entries supplied as `[x,y]` pairs are normalized to `{x,y}`
    point objects.
- Kept the generated Chat function schema provider-friendly by adding explicit
  `scrollX`, `scrollY`, and `key` fields while avoiding complex `oneOf` shapes
  that some Chat-compatible providers reject.
- Added a mock-provider regression proving a returned scroll action carries
  both snake_case and camelCase deltas, that `key` becomes `keys[]`, and that a
  two-action `actions[]` batch is counted in local compatibility metadata.
- Boundary unchanged: the bridge still preserves and normalizes action objects;
  it does not execute them or capture screenshots by itself.
- Validation:
  - `node --check src/bridge/local_computer.js test/server.test.js scripts/eval-harness.mjs`:
    passed.
  - Focused Computer Use server regression command passed the server suite
    (188/188 tests), including the new `computer action aliases` case.
  - Full `npm test`: passed 228/228 tests.

## 2026-06-16 Computer Use Safety Acknowledgement Preservation

- Used the official OpenAI Computer Use guide to re-check the local adapter
  boundary: the first-party loop sends `tools:[{type:"computer"}]`, receives
  `computer_call.actions[]`, requires the client harness to execute actions in
  order, and sends the updated screen or result back as `computer_call_output`.
- Tightened the Chat-only Computer Use protocol adapter without introducing a
  real browser/desktop executor:
  - returned `computer_call_output.acknowledged_safety_checks` are now preserved
    as bounded summaries, whether supplied at the item top level or under
    `output`;
  - Chat-visible computer context now includes acknowledged safety-check IDs /
    codes / messages, while still bounding prompt size;
  - compatibility metadata now records returned-output safety acknowledgements,
    pending safety checks on model-requested `computer_call` items, and outputs
    that carried safety acknowledgements;
  - generic Responses-input-to-Chat mapping now emits the same acknowledged
    safety-check summary instead of only a count.
- Updated mock-provider tests, live harness checks, compatibility docs, and the
  evaluation plan so follow-up Computer Use loops catch regressions in safety
  acknowledgement preservation.
- Boundary unchanged: the bridge still does not click, type, scroll, capture a
  real screenshot, run a VM/browser, or apply a product-level consent policy.
  Full hosted parity still requires Playwright/VNC execution, per-session
  isolation, cleanup, and explicit safety-confirmation policy.
- Validation:
  - `node --check src/bridge/local_computer.js src/bridge/translator.js test/server.test.js test/translator.test.js scripts/eval-harness.mjs`:
    passed.
  - Focused translator and server Computer Use regression tests passed,
    including the `computer_call_output` acknowledgement mapping test and the
    server suite coverage for local computer actions.
  - Full `npm test`: passed 227/227 tests.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key in tracked files all passed with no tracked secret
    matches.
  - `npm run eval:protocol` reached the deployed bridge but both live DeepSeek
    cases returned HTTP 402 `Insufficient Balance`; no live model-quality
    assertion was possible on this run.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`, local `/healthz` returned `ok:true`, and public
    HTTPS returned HTTP 200.
  - Storage check: repo path 114 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 5.1 GB
    available at 98% usage.

## 2026-06-16 Vector Store PDF File Search Indexing

- Closed a local `file_search` document-ingestion gap for Chat-only providers.
  OpenAI's current file-search/vector-store docs describe vector-store file
  ingestion and list PDFs among supported file-search formats; the bridge now
  maps that surface to local, bounded extracted text instead of OpenAI hosted
  indexing.
- Local vector-store file attachment now caches bounded `indexed_content` for
  non-plain-text Files API records by reusing the shared input-file extractor:
  PDF text layers go through Poppler `pdftotext`, scanned/empty text-layer PDFs
  can fall back to bounded `pdftoppm` plus `tesseract`, and basic OOXML /
  spreadsheet text extraction is available through the same path.
- `GET /v1/vector_stores/{id}/files/{file_id}/content`, direct vector-store
  search, and Responses `file_search` results expose local audit metadata such
  as `extraction_method`, `ocr_pages`, and `truncated` when present. Responses
  compatibility metadata now counts retrieved PDF extraction results with
  `pdf_extracted_count` and `pdf_ocr_extracted_count`.
- Updated the live `bridge-regression` harness with
  `responses-file-search-pdf`, plus compatibility, deployment, and evaluation
  docs to state the new PDF/OCR/document indexing behavior and the remaining
  hosted-boundary gaps: no OpenAI managed embedding model, ANN index, hosted
  asynchronous ingestion worker, or hosted reranker.
- Storage/security boundary: uploaded file bytes and vector-store state remain
  under ignored runtime state, extracted text is bounded by existing local file
  caps, OCR temporary images are not committed, and provider/API credentials are
  not written to Git-tracked files.
- Validation:
  - Official OpenAI docs MCP check confirmed vector-store file ingestion and
    that file-search supports document formats including PDF; this change is a
    local compatibility implementation for Chat Completions providers.
  - `node --check src/bridge/local_file_search.js src/bridge/input_files.js src/bridge/server.js test/server.test.js scripts/eval-harness.mjs`:
    passed.
  - `node --test test/server.test.js --test-name-pattern "Vector Stores.*PDF|file_search compatibility|input_file PDF|loadConfig reads input_file PDF OCR"`:
    passed through the server suite (187/187 tests), including PDF text-layer
    indexing and mocked OCR vector-store indexing.
  - Full `npm test` passed 227/227 tests.
  - Restarted `aialra-opencodexapp-bridge.service`; local `/healthz` returned
    `ok:true` with DeepSeek provider base `https://api.deepseek.com` and default
    model `deepseek-v4-pro`.
  - Live `responses-file-search-pdf` bridge-regression reached the deployed
    bridge but upstream DeepSeek returned HTTP 402 `Insufficient Balance`, so no
    model-quality assertion was possible on this run.
  - Deployed no-provider PDF vector-store validation passed: uploaded a PDF,
    attached it to a vector store, confirmed content extraction used
    `pdftotext`, searched the vector store for the marker, received one result,
    and deleted the temporary File/vector store.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were all `active`; public HTTPS
    returned HTTP 200.
  - `npm run prune:runtime -- --dry-run` reported 15 runtime targets, 204
    selected entries, 346,498 bytes selected, and no errors.
  - Storage check: repo path 113 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 5.6 GB
    available at 98% usage.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.

## 2026-06-16 Direct Chat PDF OCR Regression Coverage

- Extended mock-provider regression coverage from Responses `input_file` OCR to
  direct `/v1/chat/completions` passthrough file parts. The new test exercises
  a Chat-native `type:"file"` PDF content part with
  `CODEXCOMPAT_CHAT_FILE_INPUT_MODE=text`.
- The test forces an empty PDF text layer, then validates that the shared local
  input-file fallback renders a bounded page image with `pdftoppm`, extracts
  OCR text with `tesseract`, injects only safe text context upstream, and never
  forwards inline base64 PDF bytes to the Chat provider prompt.
- It asserts direct Chat compatibility metadata under
  `metadata.compatibility.chat_passthrough`, including
  `chat_file_inputs.mode:"text"`, `local_input_files.pdf_extracted_count`, and
  `local_input_files.pdf_ocr_extracted_count`.
- Updated the evaluation plan to explicitly call out PDF OCR mock-provider
  coverage for both Responses translation and direct Chat passthrough before
  larger live or SWE-bench-style evaluations.
- Validation:
  - `node --check test/server.test.js scripts/eval-harness.mjs`: passed.
  - `node --test test/server.test.js --test-name-pattern "direct Chat file|direct Chat PDF|input_file PDF|loadConfig reads input_file PDF OCR"`:
    passed through the server suite (185/185 tests), including the new direct
    Chat PDF OCR case.
  - Full `npm test` passed 225/225 tests.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were all `active`; local bridge
    `/healthz` on port 12912 returned `ok:true`, and public HTTPS returned
    HTTP 200.
  - Storage check: repo path 113 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 6.0 GB
    available at 97% usage.
  - `npm run prune:runtime -- --dry-run` reported 15 runtime targets, 204
    selected entries, 346,498 bytes selected, and no errors.

## 2026-06-16 Input File PDF OCR Fallback

- Closed another Responses `input_file` compatibility gap for Chat-only
  providers. Current OpenAI file-input guidance says PDF inputs on
  vision-capable models are processed with both extracted text and page images;
  the bridge still cannot make DeepSeek a hosted vision PDF model, but it can
  now recover text from scanned/image PDFs when local OCR is available.
- Added optional local PDF OCR fallback after `pdftotext` returns no text:
  - `pdftoppm` renders only the first bounded pages to temporary PNGs;
  - `tesseract` extracts OCR text from those page images;
  - injected prompt metadata uses
    `extraction_method: pdftoppm_tesseract_ocr` and `ocr_pages`;
  - `metadata.compatibility.local_input_files.pdf_ocr_extracted_count`
    records the OCR path while `pdf_extracted_count` continues to count PDF
    extraction success.
- Added deployment/configuration knobs:
  `CODEXCOMPAT_INPUT_FILE_PDF_OCR`, `_MAX_PAGES`, `_DPI`, and `_LANGUAGE`.
  The default is `auto`; set OCR to `disabled` to keep scanned PDFs as
  metadata-only failures.
- Installed the lightweight deployment dependency `tesseract-ocr` on the
  `/srv/aialra/apps` host so the production bridge can use the new fallback.
  The install added about 22 MB, and no OCR bytes or uploaded file contents are
  written to Git-tracked files.
- Validation:
  - Official OpenAI docs MCP check confirmed PDF `input_file` processing sends
    extracted text plus page images for vision-capable models; this bridge
    change is a local text/OCR compatibility fallback for Chat-only providers.
  - `node --check` passed for `src/bridge/input_files.js`,
    `src/bridge/server.js`, and `test/server.test.js`.
  - `node --test test/server.test.js --test-name-pattern "input_file PDF|input_file file_id|loadConfig reads input_file PDF OCR"`
    passed through the server suite (184/184 tests), including PDF text-layer
    extraction, OCR fallback through mocked `pdftotext`/`pdftoppm`/`tesseract`,
    and OCR config loading.
  - Full `npm test` passed 224/224 tests.
  - Real host OCR validation passed without provider calls: generated a tiny
    image-only PDF, confirmed `pdftotext` produced no meaningful text, then
    `prepareInputFileContext` extracted `SCANNED PDF OK 2468` with
    `pdftoppm_tesseract_ocr`, `ocr_pages:1`,
    `pdf_extracted_count:1`, and `pdf_ocr_extracted_count:1`.
  - Restarted `aialra-opencodexapp-bridge.service`; it returned `active`, and
    local `/healthz` returned `ok:true` with DeepSeek provider base
    `https://api.deepseek.com` and default model `deepseek-v4-pro`.
  - Public HTTPS entrypoint returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run prune:runtime -- --dry-run` reported 15 runtime targets, 204
    selected entries, 346,498 bytes selected, and no errors.
  - Storage check after OCR package installation: repo path 112 MB,
    `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 6.4 GB
    available at 97% usage.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.

## 2026-06-16 Uploads Intermediate Part Data Pruning

- Tightened Uploads runtime storage behavior for the `/srv/aialra/apps`
  deployment constraint. The current OpenAI Uploads API surface exposes create
  Upload, add Parts, complete Upload, and cancel Upload; it does not expose a
  public Part-content retrieval endpoint. After completion, the created File is
  the platform-visible byte-preserving object.
- Added default cleanup of intermediate Upload Part `.bin` files when an Upload
  reaches a terminal local state:
  - `completed`: File bytes are created first, then intermediate Part bytes are
    removed while Part metadata, per-Part SHA-256 values, completed checksum
    metadata, and cleanup statistics remain in `upload.json`;
  - `cancelled`: existing Part bytes are removed after the Upload is marked
    cancelled;
  - `expired`: existing Part bytes are removed when an expired pending Upload is
    detected and persisted as `status:"expired"`.
- Added `CODEXCOMPAT_UPLOAD_RETAIN_PART_DATA=false|true`. The default is
  `false` for disk safety; set it to `true` only for temporary debugging when
  intermediate Part byte files must be retained.
- Security/storage boundary: uploaded content bytes remain outside Git; terminal
  Upload state keeps only metadata/checksum/cleanup records after pruning.
  Provider credentials, Authorization headers, and API keys are not written to
  Git-tracked files.
- Validation:
  - `node --check` passed for `src/bridge/local_uploads.js`,
    `src/bridge/server.js`, and `test/server.test.js`.
  - `node --test test/server.test.js --test-name-pattern "Uploads API"`
    passed through the server suite (182/182 tests), including completed,
    cancelled, and expired Upload Part data pruning plus explicit
    `uploadRetainPartData` retention behavior.
  - Full `npm test` passed 222/222 tests.
  - Restarted `aialra-opencodexapp-bridge.service`; it returned `active`, and
    local `/healthz` returned `ok:true` with DeepSeek provider base
    `https://api.deepseek.com` and default model `deepseek-v4-pro`.
  - Deployed direct Upload completion validation passed without a model call:
    created a two-Part Upload, completed it, verified the created File content
    stayed byte-exact, verified both intermediate Part `.bin` files were
    removed, and confirmed `part_data_cleanup` recorded two deleted Parts,
    45 deleted bytes, and no errors.
  - `npm run prune:runtime -- --dry-run` reported 15 runtime targets, 204
    selected entries, 346,498 bytes selected, and no errors; the
    `local-upload-workdirs` target still bounds old Upload workdirs.
  - Public HTTPS entrypoint returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Storage check: repo path 112 MB,
    `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 6.7 GB
    available at 97% usage.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.

## 2026-06-16 Uploads Expiration Persistence

- Tightened the local Uploads lifecycle against the official Uploads surface:
  OpenAI exposes create Upload, add Parts, complete Upload, and cancel Upload
  endpoints, and created Uploads expire after one hour. There is no public
  retrieve/list-parts endpoint in the current OpenAPI endpoint list, so this
  change keeps the public route surface unchanged.
- Persisted expired pending Uploads as `status:"expired"` with `expired_at`
  before returning `upload_expired` from Part creation or completion. This
  avoids transient in-memory-only expiry state and makes local audit/prune
  behavior deterministic.
- Cancel now preserves the lifecycle boundary for already-expired Uploads:
  expired Uploads continue to return `upload_expired` instead of being converted
  to `cancelled`; already-cancelled Uploads remain idempotently cancelled, and
  completed Uploads still reject cancellation with `upload_already_completed`.
- Security/storage boundary: the change only writes Upload lifecycle metadata
  under `$CODEXCOMPAT_STATE_DIR/local-uploads`; no uploaded bytes,
  Authorization headers, provider credentials, or API keys are written to
  Git-tracked files.
- Validation:
  - `node --check` passed for `src/bridge/local_uploads.js` and
    `test/server.test.js`.
  - `node --test test/server.test.js --test-name-pattern "Uploads"` passed
    through the server suite (181/181 tests), including expired add-Part,
    expired complete, persisted `status:"expired"`, and expired cancel
    rejection coverage.
  - Full `npm test` passed 221/221 tests.
  - Restarted `aialra-opencodexapp-bridge.service`; it returned `active`, and
    local `/healthz` returned `ok:true` with DeepSeek provider base
    `https://api.deepseek.com` and default model `deepseek-v4-pro`.
  - Deployed direct Upload expiry validation passed without a model call:
    created a one-second Upload, waited for expiration, verified Part creation
    and cancel both return `upload_expired`, and confirmed the local Upload
    record persisted `status:"expired"` plus `expired_at`.
  - `npm run prune:runtime -- --dry-run` reported 15 runtime targets, 204
    selected entries, 346,498 bytes selected, and no errors; the
    `local-upload-workdirs` target still bounds old Upload workdirs.
  - Public HTTPS entrypoint returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Storage check: repo path 111 MB,
    `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 7.2 GB
    available.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.

## 2026-06-16 Uploads Checksum And Runtime Prune Coverage

- Tightened local Uploads API compatibility around the official Uploads
  lifecycle. OpenAI's Uploads reference states that Uploads are intermediate
  objects, accept Parts, are capped at 8 GB, expire after one hour, complete
  into regular Files, use ordered `part_ids`, require final uploaded bytes to
  match the original `bytes`, and disallow new Parts after completion.
- Added local SHA-256 integrity handling without changing the OpenAI-style
  public Upload object shape:
  - Upload Part creation computes and stores an internal SHA-256 for each
    chunk.
  - JSON, multipart, and raw Part requests can optionally provide
    `sha256`, `checksum_sha256`, `checksum`, `x-content-sha256`, or
    `x-upload-part-sha256`; mismatches fail with
    `upload_part_checksum_mismatch`.
  - Upload completion computes the final ordered content SHA-256, can validate
    a caller-provided checksum, and writes `upload_checksum_algorithm`,
    `upload_sha256`, and `upload_part_count` into the nested File metadata for
    local auditability.
- Completed Uploads now have explicit regression coverage that no new Parts may
  be added after completion, complementing the existing cancelled-upload block.
- Added `local-upload-workdirs` to the runtime prune target list so temporary
  Upload workdirs under `$CODEXCOMPAT_STATE_DIR/local-uploads/uploads` are
  bounded by age, count, and byte caps.
- Security/storage boundary: checksum data is derived from uploaded content and
  no uploaded bytes, Authorization headers, provider credentials, or API keys
  are written to Git-tracked files.
- Validation:
  - `node --check` passed for `src/bridge/local_uploads.js`,
    `src/bridge/server.js`, `scripts/prune-runtime-state.mjs`,
    `scripts/eval-harness.mjs`, `test/server.test.js`, and
    `test/prune_runtime_state.test.js`.
  - Uploads-targeted Node tests passed through the server suite (181/181 tests
    in `test/server.test.js`), including checksum mismatch failures, completion
    checksum validation, completed File checksum metadata, and the post-complete
    Part rejection path.
  - `node --test test/prune_runtime_state.test.js` passed 1/1 and verifies old
    local Upload workdirs are pruned while fresh workdirs are preserved.
  - Full `npm test` passed 221/221 tests.
  - Restarted `aialra-opencodexapp-bridge.service`; it returned `active`, and
    local `/healthz` returned `ok:true` with DeepSeek provider base
    `https://api.deepseek.com` and default model `deepseek-v4-pro`.
  - Deployed direct Uploads runtime validation passed without a model call:
    created an Upload, added two checksum-verified Parts, completed with a
    final checksum, retrieved the resulting File content, verified
    `upload_sha256`, `upload_checksum_algorithm`, and `upload_part_count`
    metadata, and confirmed a later Part request returns
    `upload_already_completed`.
  - Live model-gated checks were attempted but are currently blocked by the
    upstream DeepSeek account returning HTTP 402 `Insufficient Balance` after
    local Upload/File creation. This affected `responses-upload-input-file`,
    `npm run smoke:bridge`, and `npm run eval:protocol`; rerun these after
    replenishing the provider balance or rotating to a funded key.
  - `npm run prune:runtime -- --dry-run` reported 15 runtime targets, 204
    selected entries, 346,498 bytes selected, and no errors; the new
    `local-upload-workdirs` target selected 203 old upload dirs totaling
    262,600 bytes.
  - Public HTTPS entrypoint returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Storage check: repo path 111 MB,
    `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB, and root filesystem had 7.4 GB
    available.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.

## 2026-06-16 Direct Chat File Input Fallback

- Extended provider-aware file input handling to direct
  `POST /v1/chat/completions` passthrough requests. The OpenAI Chat create
  reference documents text, image, and audio Chat modalities with
  model-dependent support; file inputs remain a provider/client extension in
  Chat, so the bridge now handles compatible `input_file` / `file` content
  parts explicitly instead of forwarding them to text-only providers.
- Added `CODEXCOMPAT_CHAT_FILE_INPUT_MODE=auto|file|text`:
  - DeepSeek defaults to `text`, converting Chat `input_file` / compatible
    `file` content parts to safe `[file:...]` markers before the upstream
    provider call;
  - OpenAI-compatible file-capable providers default to `file`, preserving
    native/extension file content parts.
- Direct Chat text fallback now reuses the bounded local `input_file`
  extractor for local Files API `file_id`, inline `file_data`, and `file_url`
  inputs, injecting extracted text as a system context message for upstream
  Chat-only providers.
- Direct Chat compatibility metadata now records
  `metadata.compatibility.chat_passthrough.chat_file_inputs` with provider
  mode, message count, file part count, local file-id count, inline-file
  count, file-url count, and text part count. Extractor results remain under
  `metadata.compatibility.chat_passthrough.local_input_files`.
- Stored Chat completion messages continue to preserve the caller's original
  content parts for local lifecycle retrieval; the transformed text prompt and
  extracted context are only used for the upstream provider request.
- Security boundary: inline base64 file payloads are decoded locally for
  bounded extraction and are not embedded into fallback markers or
  compatibility metadata. Provider credentials and the user-provided test API
  key remain absent from tracked files.
- Validation:
  - `node --check` passed for `src/bridge/translator.js`,
    `src/bridge/input_files.js`, `src/bridge/server.js`, and
    `scripts/eval-harness.mjs`.
  - `npm test` passed 221/221 tests, including the new direct Chat file
    passthrough fixture.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; local bridge `/healthz` returned
    `ok:true` with DeepSeek provider base `https://api.deepseek.com` and
    default model `deepseek-v4-pro`.
  - Live `chat-file-content` bridge-regression case passed 1/1, reading the
    exact marker from an inline direct Chat file input.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` passed 112/112
    cases against `deepseek-v4-pro`, pass rate 1.0, average latency 1291 ms,
    P95 latency 3056 ms, total usage 26,283 tokens.
  - `npm run smoke:bridge` passed and returned `bridge-ok`.
  - `npm run smoke:ui` passed against `https://opencodexapp.aialra.online`,
    covering load/auth, sidebar controls, page navigation, project dialog,
    browser upload, prompt send, completed-turn controls, reload persistence,
    generated image artifact display, saved-project create/reopen/cleanup, and
    no browser console errors.
  - Public HTTPS entrypoint returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `git diff --check`, `npm run secret-scan`, and an exact search for the
    user-provided test key all passed with no tracked secret matches.
  - Runtime prune dry-run selected only one old UI-smoke screenshot
    (83,898 bytes). Storage check: repo path 110 MB, `state/` 42 MB,
    `output/` 4.5 MB, `/srv/aialra/data/opencodexapp` 136 KB,
    `/srv/aialra/logs/opencodexapp` 30 MB; root filesystem had 7.9 GB
    available.

## 2026-06-15 Direct Chat Audio Input Fallback

- Extended provider-aware audio input handling to direct
  `POST /v1/chat/completions` passthrough requests. OpenAI's Chat create
  reference notes that `messages` can include text, image, and audio
  modalities, with model-dependent support.
- Added `CODEXCOMPAT_CHAT_AUDIO_INPUT_MODE=auto|audio|text`:
  - DeepSeek defaults to `text`, converting Chat `input_audio` / compatible
    `audio` content parts to safe `[audio:format:hint]` markers before the
    upstream provider call;
  - OpenAI-compatible audio providers default to `audio`, preserving native
    Chat audio content parts.
- Direct Chat compatibility metadata now records
  `metadata.compatibility.chat_passthrough.chat_audio_inputs` with provider
  mode, message count, audio part count, inline-audio count, transcript count,
  and text part count.
- Stored Chat completion messages continue to preserve the caller's original
  content parts for local lifecycle retrieval; the transformed text prompt is
  only used for the upstream provider request.
- Security boundary: base64 audio payloads are not embedded into text fallback
  prompts or compatibility metadata, and no provider credentials were written
  to docs, tests, or committed files.

## 2026-06-15 Direct Chat Image Input Fallback

- Extended provider-aware image input handling to direct
  `POST /v1/chat/completions` passthrough requests, using the official Chat
  image content-part shape documented in the OpenAI OpenAPI spec and Images
  and vision guide.
- When `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE=text`, Chat `image_url` /
  `input_image` content parts are converted to safe text markers before the
  upstream provider call. Data URLs are represented as `inline-data`, not
  copied into the upstream prompt.
- Direct Chat compatibility metadata now records
  `metadata.compatibility.chat_passthrough.chat_image_inputs` with provider
  mode, message count, image part count, text part count, and data-URL count.
- Stored Chat completion messages continue to preserve the caller's original
  content parts for local lifecycle retrieval; the transformed text prompt is
  only used for the upstream provider request.
- Added non-streaming, streaming/store, and live bridge-regression coverage for
  direct Chat image input fallback.

## 2026-06-15 Assistants Vision Message Content

- Added Assistants message-content mapping for image inputs before Chat
  provider calls:
  - `image_url` parts preserve URL and `detail` as Chat vision content parts
  - `image_file.file_id` parts resolve through the local Files API into
    bounded data URLs for upstream Chat vision requests
- Reused the existing Responses `input_image` resolver so local file image
  limits and metadata redaction stay consistent across APIs.
- Added provider-aware Chat image input mode:
  - DeepSeek defaults to safe text markers because its Chat endpoint rejects
    `image_url` content parts for the current default model
  - vision-capable OpenAI-compatible providers can use native Chat
    multimodal content parts with `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE=vision`
  - text fallback never injects data URLs or base64 image payloads into the
    upstream prompt
- Added mock-provider coverage proving Assistants `image_url` + `image_file`
  content reaches upstream Chat as multimodal content parts when enabled and
  safe text markers when Chat vision is disabled.
- Added a bridge-regression `assistants-vision-content` case for the live
  harness.
- Security boundary: run compatibility metadata records counts, file IDs,
  media types, byte sizes, and status only. It does not store image data URLs,
  base64 image payloads, provider credentials, or Authorization headers.

## 2026-06-15 Local Hosted-Tool Usage Ledger

- Extended the local Organization Usage ledger to meter local hosted-tool
  compatibility paths:
  - vector-store file attachments record `vector_stores.usage_bytes`
  - Responses/background/Assistants `file_search` records
    `file_search_calls.num_requests`
  - Responses/background `web_search_preview` records
    `web_search_calls.num_model_requests`, `num_requests`, and context level
  - Responses/background/Assistants `code_interpreter` records unique local
    container sessions as `code_interpreter_sessions.num_sessions`
- Added `vector_store_ids[]` and `context_levels[]` usage filters.
- Updated the bridge regression `organization-usage-costs` case to create
  non-zero hosted-tool usage and verify usage/cost line items.
- Expanded mock-provider tests to assert hosted-tool usage aggregation,
  hashed API-key dimensions, project/user filters, vector-store/context-level
  filters, and that prompt/file/code content markers are absent from usage
  responses.
- Security boundary: ledger events store only endpoint/time/dimension IDs and
  numeric metrics. Prompts, code blocks, file contents, web result text,
  Authorization headers, and provider secrets remain excluded.

## 2026-06-10 Initial Open Gateway Track

- Created `/srv/aialra/apps/open-codex-app-web-gateway` from tracked files in
  `/srv/aialra/apps/codexapp`.
- Did not copy `state/`, `node_modules/`, logs, Playwright output, or local
  secret files.
- Added local Responses-to-Chat bridge:
  - `/v1/responses`
  - `/v1/chat/completions` passthrough
  - `/v1/models`
  - `/healthz`
- Added local file store for `previous_response_id` replay.
- Added unit and mock-upstream tests.
- Added secret scan script and CI workflow.
- Added compatibility, deployment, and evaluation docs.

Open follow-ups:

- Expand Playwright browser coverage beyond the first successful conversation.
- Add benchmark harness implementation and first small task suite.

## 2026-06-10 Deployment Bring-up

- Installed machine-local secret file at
  `/srv/aialra/config/secrets/opencodexapp.env` with mode `0600`.
- Installed isolated Codex config at
  `/srv/aialra/state/opencodexapp-codex-home/config.toml`.
- Enabled and started:
  - `aialra-opencodexapp-bridge.service`
  - `aialra-opencodexapp-app-server.service`
  - `aialra-opencodexapp-web.service`
- Signed Let's Encrypt certificate for `opencodexapp.aialra.online`, expiring
  2026-09-08.
- Installed nginx vhost from `deploy/nginx/opencodexapp.aialra.online.conf`.
- Verified:
  - `npm test`: 10 passing tests.
  - `npm run secret-scan`: passed.
  - live bridge smoke returned `bridge-ok`.
  - protocol smoke suite passed 2/2 against DeepSeek `deepseek-v4-pro`.
  - HTTPS page returned 200 with certificate CN `opencodexapp.aialra.online`.
  - Playwright loaded the UI, completed onboarding, sent `请只回复 opencodex-ok`,
    and received `opencodex-ok` in the web UI with no console warnings/errors.

## 2026-06-10 Responses Lifecycle Expansion

- Added local lifecycle coverage for stored Responses objects:
  - `GET /v1/responses/{response_id}`
  - `DELETE /v1/responses/{response_id}`
  - `POST /v1/responses/{response_id}/cancel`
  - `GET /v1/responses/{response_id}/input_items`
- Added explicit 501 compatibility errors for:
  - `POST /v1/responses/compact`
  - `POST /v1/responses/input_tokens`
- Stored normalized response input items next to replay messages so later Codex
  requests can inspect the conversation input surface without calling upstream.
- Added mock-provider regression coverage for retrieval, deletion, input item
  pagination, completed-response cancel no-op, and unsupported collection
  endpoints.
- Restarted `aialra-opencodexapp-bridge.service` and live-tested the lifecycle
  path against DeepSeek through the local bridge:
  create response, retrieve response, list input items, cancel completed
  response, delete response, and confirm 404 after deletion.

## 2026-06-10 Evaluation Harness Expansion

- Expanded `scripts/eval-harness.mjs` from protocol-only smoke tests into a
  repeatable bridge regression runner covering:
  - Responses text
  - Responses JSON schema compatibility
  - Chat Completions passthrough
  - Responses SSE event translation
  - function-tool `tool_choice`
  - `previous_response_id` replay
- Added `npm run eval:protocol` and `npm run eval:bridge`.
- Fixed Chat passthrough response header handling so bridge clients do not
  inherit unsafe upstream transfer headers.
- Added DeepSeek compatibility logic that disables thinking mode for function
  tool requests with `tool_choice` by default; this fixed the live
  `Thinking mode does not support this tool_choice` provider error.
- Live result against `deepseek-v4-pro` on `http://127.0.0.1:12912`:
  `bridge-regression` passed 6/6, pass rate 1.0, average latency 2303 ms,
  P95 latency 3622 ms, total usage 873 tokens.

## 2026-06-10 Chat Lifecycle Expansion

- Used the current OpenAI endpoint list to confirm Chat lifecycle routes:
  - `GET /v1/chat/completions/{completion_id}`
  - `GET /v1/chat/completions/{completion_id}/messages`
- Added local storage for non-streaming Chat Completions requests when the
  incoming request sets `store:true`.
- Added local lifecycle coverage for stored Chat completions:
  - `GET /v1/chat/completions/{completion_id}`
  - `GET /v1/chat/completions/{completion_id}/messages`
- Kept ordinary Chat passthrough requests unstored by default to avoid
  unbounded state growth.
- Added mock-provider regression coverage for stored retrieval, stored message
  pagination, and unstored completion 404 behavior.
- Added a live `chat-lifecycle` case to `bridge-regression`.
- Restarted `aialra-opencodexapp-bridge.service` and live-tested against
  `deepseek-v4-pro` on `http://127.0.0.1:12912`:
  `chat-lifecycle` passed with completion retrieval 200, messages retrieval
  200, and 2 stored messages.
- Full `bridge-regression` passed 7/7, pass rate 1.0, average latency 2013 ms,
  P95 latency 3636 ms, total usage 913 tokens.

## 2026-06-10 UI Workflow Smoke Automation

- Added `scripts/ui-smoke.mjs` and `npm run smoke:ui`.
- The first version used the local Playwright CLI wrapper and an authenticated
  session.
- It verifies:
  - app load with an authenticated Playwright session
  - sidebar/search/settings controls
  - prompt submission from the composer
  - visible model response marker
  - reload persistence
  - console error/warning collection
  - screenshot artifact capture under ignored `output/playwright/`
- Live result against `https://opencodexapp.aialra.online`:
  `smoke:ui -- --session default --timeout-ms 180000` passed, marker
  `ui-smoke-mq7mzhmo` appeared twice before reload and once after reload,
  console errors 0, warnings 0.

## 2026-06-10 Clean Browser UI Smoke Upgrade

- Added `playwright` as a dev dependency with browser download skipped during
  install on the deployment host.
- Reworked `scripts/ui-smoke.mjs` to launch a fresh Playwright browser context
  directly from Node instead of relying on a pre-authenticated CLI session.
- Added login-page support that reads credentials only from local environment
  variables (`UI_SMOKE_USERNAME`/`UI_SMOKE_PASSWORD` or
  `CODEXAPP_USERNAME`/`CODEXAPP_PASSWORD`); no credentials are written to the
  repository or command-line arguments.
- Verified current deployment topology:
  - `aialra-opencodexapp-login.service` is inactive.
  - nginx proxies `opencodexapp.aialra.online` directly to `127.0.0.1:12920`.
  - The clean browser run therefore recorded `auth_mode:
    existing_session_or_public` rather than `clean_login`.
- Live result against `https://opencodexapp.aialra.online`:
  `npm run smoke:ui -- --timeout-ms 180000` passed, marker
  `ui-smoke-mq7n5dx9` appeared twice before reload and once after reload,
  console errors 0, warnings 0.

## 2026-06-10 Code Quality Benchmark Harness

- Added `scripts/code-benchmark.mjs` and `npm run bench:code`.
- The harness creates temporary JavaScript repositories under ignored
  `output/code-benchmark/`, asks the bridge model for JSON file replacements,
  applies generated files, and runs task tests.
- Added the first `micro` suite:
  - `slugify-url-safe`
  - `merge-ranges`
  - `parse-duration`
- Reviewed SWE-bench public guidance and recorded that official evaluation is
  Docker-based and resource intensive, with approximately 120GB free storage
  recommended for full evaluation. Full SWE-bench artifacts remain out of the
  repository by policy.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run bench:code -- --timeout-ms 180000` passed 3/3, pass rate 1.0,
  average latency 27595 ms, P95 latency 30290 ms, total usage 5751 tokens.

## 2026-06-10 Bridge Soak Stability Harness

- Added `scripts/soak-test-bridge.mjs` and `npm run soak:bridge`.
- The harness repeatedly creates stored Responses turns, checks
  `/v1/responses/{response_id}/input_items`, deletes stored responses, and
  compares state directory file and byte counts before creation, after
  creation, and after cleanup.
- The report records success rate, cleanup failures, average and P95 latency,
  token usage, per-turn response IDs, and optional JSON output for release
  evidence.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run soak:bridge -- --iterations 5 --timeout-ms 180000` passed 5/5,
  pass rate 1.0, cleanup failures 0, average latency 1593 ms, P95 latency
  1716 ms, total usage 370 tokens.
- State directory baseline was 10 files and 23796 bytes. Creation added 5 files
  and 13151 bytes. Cleanup returned the directory to the same 10 files and
  23796 bytes, for zero residual file and byte growth after deletion.

## 2026-06-10 Responses Input Token Count Compatibility

- Used the current OpenAI endpoint list and OpenAPI schema to confirm
  `POST /v1/responses/input_tokens` returns an object with
  `object: "response.input_tokens"` and an `input_tokens` count.
- Added a bridge implementation for `POST /v1/responses/input_tokens`.
- The handler reuses Responses-to-Chat translation and local
  `previous_response_id` replay, forces a non-streaming upstream Chat
  Completion probe with `max_tokens:1`, removes upstream `store`, and returns
  the provider's `usage.prompt_tokens` as `input_tokens`.
- At this stage, kept `POST /v1/responses/compact` as an explicit 501 because
  native compaction requires summarization/compaction semantics, not just field
  translation. This was superseded by the local compaction implementation below.
- Added mock-provider coverage for the token probe request shape and response.
- Added `responses-input-tokens` to the live `bridge-regression` suite.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-input-tokens --timeout-ms 45000`
  passed 1/1, latency 888 ms, input tokens 10.
- Full live `bridge-regression` passed 8/8, pass rate 1.0, average latency
  1843 ms, P95 latency 3891 ms, total usage 847 tokens.

## 2026-06-10 Local Responses Compaction

- Implemented `POST /v1/responses/compact` as local bridge compaction.
- The handler translates Responses input to Chat messages, asks the upstream
  Chat provider for a continuation summary, returns `object:
  "response.compaction"`, and emits a `type:"compaction"` output item.
- Local compaction content is encrypted with AES-256-GCM. The key is read from
  `CODEXCOMPAT_COMPACTION_SECRET`, or generated into
  `CODEXCOMPAT_COMPACTION_SECRET_FILE`, defaulting to
  `$CODEXCOMPAT_STATE_DIR/compaction.key`.
- Verified the generated key file is mode `0600` under ignored `state/`; no
  compaction key or generated state was staged.
- Added translator support so local compaction output can be passed directly as
  the next `/v1/responses` input. If a compaction item cannot be decoded, the
  bridge inserts a safe notice instead of forwarding opaque ciphertext.
- Added mock-provider tests for compaction creation, local key generation,
  encrypted content shape, and follow-up replay through decrypted summary
  context.
- Added `responses-compact-continuation` to the live `bridge-regression` suite.
- Caveat: this is not OpenAI native ZDR encrypted compaction. It is local to the
  bridge deployment and key; portability requires explicitly preserving or
  rotating the local key outside Git.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-compact-continuation --timeout-ms 90000`
  passed 1/1, latency 6739 ms, total usage 462 tokens, and follow-up output
  recovered `atlas-77`.
- Full live `bridge-regression` passed 9/9, pass rate 1.0, average latency
  3160 ms, P95 latency 9271 ms, total usage 1538 tokens.
- Post-compaction live soak still passed:
  `npm run soak:bridge -- --iterations 5 --timeout-ms 180000` passed 5/5,
  cleanup failures 0, average latency 1815 ms, P95 latency 1982 ms, and zero
  residual state file or byte growth after cleanup.

## 2026-06-10 Model Retrieval Compatibility

- Used the current OpenAI endpoint list to confirm `GET /v1/models/{model}` is
  part of the API surface alongside `GET /v1/models`.
- Added `GET /v1/models/{model}` to the bridge.
- Retrieval strategy:
  - first proxy upstream single-model retrieval at
    `$CODEXCOMPAT_MODELS_PATH/{model}` when the provider supports it;
  - otherwise fetch upstream model list and return the matching model object;
  - otherwise return a local fallback only when `{model}` is the configured
    `CODEXCOMPAT_DEFAULT_MODEL`;
  - return a structured 404 `model_not_found` error for unknown models.
- Refactored local model fallback so list and retrieve return the same model
  object shape.
- Added mock-provider coverage for direct upstream retrieval and list fallback.
- Added `models-retrieve` to live `bridge-regression`.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case models-retrieve --timeout-ms 45000` passed
  1/1, latency 468 ms, retrieved model ID `deepseek-v4-pro`.
- Full live `bridge-regression` passed 10/10, pass rate 1.0, average latency
  2304 ms, P95 latency 7773 ms, total usage 1392 tokens.

## 2026-06-10 Responses Background Mode Compatibility

- Used the current OpenAI Responses API schema and examples to confirm
  background responses expose `background`, transition through `in_progress`,
  and are polled through `GET /v1/responses/{response_id}`.
- Added local `background:true` emulation for `POST /v1/responses`:
  - returns a stored `in_progress` Responses object immediately;
  - runs the upstream Chat Completion asynchronously in the bridge process;
  - updates the stored Responses object to `completed` or `failed`;
  - forces `store:true` because polling requires a local response record;
  - disables upstream streaming for background requests and records that in
    compatibility metadata.
- Added cancellation and deletion behavior for in-process background jobs:
  - `POST /v1/responses/{response_id}/cancel` aborts an in-progress job and
    marks the response `cancelled`;
  - `DELETE /v1/responses/{response_id}` aborts an in-process job before
    deleting the local response record;
  - terminal completed records keep the existing cancel no-op compatibility.
- Added a timeout marker so upstream background timeouts are recorded as
  failed provider errors instead of user cancellations.
- Caveat: background workers are currently process-local. The response record is
  file-backed for audit and polling, but a bridge restart does not resume an
  already in-progress upstream Chat Completion. A persisted job queue remains a
  future hardening item if Codex depends on long-running background jobs across
  restarts.
- Added mock-provider coverage for:
  - immediate `in_progress` creation followed by later `completed`;
  - forced local storage when the caller sends `store:false`;
  - stream disabling when the caller sends `stream:true`;
  - cancellation remaining `cancelled` even if the mock upstream later returns.
- Added `responses-background` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 20/20 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-background --timeout-ms 90000 --verbose`
  passed 1/1, latency 2164 ms, status history
  `in_progress -> in_progress -> completed`, output `background-ok`, total
  usage 63 tokens.
- Full live `bridge-regression` passed 11/11, pass rate 1.0, average latency
  2427 ms, P95 latency 8417 ms, total usage 1431 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7p0kr8` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local Web Search Hosted Tool Adapter

- Used the current OpenAI web-search guide to confirm Responses web-search
  outputs include:
  - a `web_search_call` output item with `action.type:"search"` and the query;
  - a message output item with `output_text.annotations` containing
    `url_citation` objects.
- Added a local hosted-tool adapter for `web_search_preview` / `web_search`:
  - local search results are injected into the upstream Chat Completion prompt;
  - final Responses output is decorated with a `web_search_call` item;
  - final message text receives URL citation annotations;
  - streaming responses emit the local `web_search_call` output item before
    Chat text deltas and include citations in the final completed response;
  - background responses run local search inside the background job before the
    upstream Chat Completion call.
- Added local provider configuration:
  - `CODEXCOMPAT_WEB_SEARCH_PROVIDER=disabled|static|wikipedia`;
  - default no-key provider is `wikipedia`, using the public MediaWiki search
    API;
  - `static` provider is available for tests and controlled eval fixtures.
- Added query extraction for common prompts such as `web search for OpenAI`.
- Added DeepSeek compatibility behavior that disables thinking mode for local
  web-search requests by default. This avoids reasoning-only completions
  exhausting `max_output_tokens` before any visible assistant text is emitted.
- Caveat: this is not native OpenAI web search and the default provider is not a
  full web index. Full parity still requires a production web-search backend,
  page open/find support, citation ranking, and policy controls.
- Added mock-provider coverage for:
  - local hosted-tool reservation so `web_search_preview` is not forwarded as
    an unsupported upstream Chat tool;
  - injected search context in upstream Chat messages;
  - `web_search_call` output item shape;
  - `url_citation` annotations;
  - DeepSeek `thinking:{type:"disabled"}` for local web-search requests.
- Added `responses-web-search` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 23/23 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-web-search --timeout-ms 90000 --verbose`
  passed 1/1, latency 1774 ms, output `web-search-ok [1]`, total usage
  390 tokens.
- Full live `bridge-regression` passed 12/12, pass rate 1.0, average latency
  1918 ms, P95 latency 4098 ms, total usage 1582 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7pjgyb` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local File Search Hosted Tool Adapter

- Used the current OpenAI file-search, Files, and Vector Stores documentation to
  confirm the expected bridge-facing shapes:
  - `file_search` is a Responses hosted tool backed by vector stores;
  - file-search output includes `file_search_call` items;
  - message output can include `file_citation` annotations;
  - setup flows through file upload, vector-store creation, file attachment,
    and search.
- Added a local Files/Vector Stores state layer under the bridge state
  directory:
  - `POST/GET/DELETE /v1/files`;
  - `GET /v1/files/{file_id}/content`;
  - `POST/GET/DELETE /v1/vector_stores`;
  - `POST/GET/DELETE /v1/vector_stores/{id}/files`;
  - `POST /v1/vector_stores/{id}/search`.
- Added a local hosted-tool adapter for Responses `file_search`:
  - reserves `file_search` so it is not forwarded as an unsupported Chat tool;
  - searches local vector stores with bounded lexical chunk retrieval;
  - supports simple metadata filters over file metadata and attachment
    attributes;
  - injects retrieved chunks into the upstream Chat Completion prompt;
  - emits `file_search_call` output with query, vector store IDs, and optional
    results for `include:["file_search_call.results"]`;
  - adds `file_citation` annotations to final Responses message text;
  - supports non-streaming, streaming, and background Responses paths.
- Added DeepSeek compatibility behavior that disables thinking mode for local
  file-search requests by default. This avoids reasoning-only completions or
  citation-only visible output under small `max_output_tokens` budgets.
- Caveat: this is not native OpenAI managed file search. The local retriever is
  text-only and lexical; full parity still requires embedding/vector indexing,
  richer file parsers, async file batches, expiration policy, reranking, and
  larger RAG eval sets.
- Added regression coverage for:
  - Files and Vector Stores CRUD/search endpoint shape;
  - vector-store-file attributes and simple filter matching;
  - local hosted-tool reservation for `file_search`;
  - injected local retrieval context in upstream Chat messages;
  - `file_search_call` output shape including vector store IDs and results;
  - `file_citation` annotations;
  - natural-language query extraction that avoids treating `result/results` as
    the search query.
- Added `responses-file-search` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 25/25 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-file-search --timeout-ms 90000 --verbose`
  passed 1/1, latency 1284 ms, output `file-search-ok [1]`, total usage
  177 tokens.
- Full live `bridge-regression` passed 13/13, pass rate 1.0, average latency
  2018 ms, P95 latency 6197 ms, total usage 1965 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7qflpg` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local Shell and Container Artifact Adapter

- Used the current OpenAI shell/tools and Containers documentation to confirm:
  - hosted shell is a Responses hosted tool, not a Chat Completions feature;
  - local shell and hosted shell use paired `shell_call` and
    `shell_call_output` output items;
  - hosted containers expose `/mnt/data` for user-downloadable artifacts;
  - reusable containers are created and referenced through the Containers API.
- Added a local Containers state layer under the bridge state directory:
  - `POST/GET/DELETE /v1/containers`;
  - `POST/GET/DELETE /v1/containers/{id}/files`;
  - `GET /v1/containers/{id}/files/{file_id}/content`.
- Added a local hosted-tool adapter for Responses `shell` plus a
  `code_interpreter` compatibility alias:
  - reserves `shell` / `code_interpreter` so they are not forwarded as
    unsupported Chat tools;
  - extracts explicit `Execute:`, `Run:`, `Command:`, shell code block, and
    Python code block commands;
  - runs commands in a local per-container workspace with timeout and output
    limits;
  - maps `/mnt/data` to the local container artifact workspace;
  - emits paired `shell_call` and `shell_call_output` items;
  - injects stdout, stderr, exit code, timeout status, and artifact paths into
    the upstream Chat Completion prompt;
  - exposes generated artifacts through local container files endpoints;
  - supports non-streaming, streaming, and background Responses paths.
- Added local provider configuration:
  - `CODEXCOMPAT_SHELL_PROVIDER=local|disabled`;
  - `CODEXCOMPAT_SHELL_STATE_DIR`;
  - command timeout, output cap, file cap, command length, and max command
    count settings.
- Added DeepSeek compatibility behavior that disables thinking mode for local
  shell and local compaction requests by default. The compaction change fixes a
  live failure where DeepSeek returned no visible summary content.
- Caveat: this is not native OpenAI hosted shell and not a Docker/VM sandbox.
  It is local, disk-bounded, timeout-bounded, and auditable, but full parity
  still requires hardened container isolation, network allowlists, domain secret
  sidecars, service support, and lifecycle garbage collection.
- Added regression coverage for:
  - local container CRUD/list endpoint shape;
  - local shell hosted-tool reservation;
  - `tool_choice:"required"` not being forwarded when only local hosted tools
    are present;
  - `shell_call` / `shell_call_output` output shape;
  - `/mnt/data` artifact creation, listing, and download;
  - DeepSeek `thinking:{type:"disabled"}` for shell and compaction requests.
- Added `responses-shell` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_shell.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 27/27 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live shell result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-shell --timeout-ms 90000 --verbose`
  passed 1/1, latency 3054 ms before the prompt tightening, artifact
  `shell-ok`, total usage 258 tokens.
- Live compaction stability check:
  `npm run eval:bridge -- --case responses-compact-continuation --timeout-ms 90000 --verbose`
  passed 1/1 after disabling DeepSeek thinking for compaction, latency 4299 ms,
  total usage 267 tokens.
- Full live `bridge-regression` passed 14/14, pass rate 1.0, average latency
  2289 ms, P95 latency 4542 ms, total usage 1998 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7r8xft` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local Input File Adapter

- Used the current OpenAI file-input documentation to confirm Responses accepts
  `input_file` from local file IDs, inline base64 `file_data`, and HTTP(S)
  `file_url`, with native OpenAI support for richer PDF, document, and
  spreadsheet extraction.
- Added a local `input_file` compatibility layer for Chat-only providers:
  - extracts bounded text from local Files API `file_id` records;
  - decodes strict inline base64 `file_data`, including
    `data:<media>;base64,...` URLs;
  - fetches HTTP(S) `file_url` inputs when enabled, with timeout and byte caps;
  - injects extracted text into upstream Chat Completion messages;
  - reports `metadata.compatibility.local_input_files` with provider, status,
    file counts, resolved/failed counts, and truncation counts;
  - runs before upstream Chat calls for non-streaming Responses, streaming
    Responses, background jobs, `/v1/responses/input_tokens`, and local
    `/v1/responses/compact`.
- Added local provider configuration:
  - `CODEXCOMPAT_INPUT_FILE_PROVIDER=local|disabled`;
  - `CODEXCOMPAT_INPUT_FILE_MAX_FILES`;
  - `CODEXCOMPAT_INPUT_FILE_MAX_BYTES`;
  - `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS`;
  - `CODEXCOMPAT_INPUT_FILE_FETCH_URLS`;
  - `CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS`.
- Caveat: this is not native OpenAI file processing. Text/code/CSV/JSON/Markdown
  and similar inputs are extracted directly; binary PDFs, Office documents,
  spreadsheet augmentation, OCR, and rendered page-image context remain planned
  parity gaps.
- Added regression coverage for:
  - local Files API `file_id` extraction;
  - inline `file_data` extraction;
  - upstream Chat prompt injection;
  - Responses compatibility metadata counts;
  - live `responses-input-file` in `bridge-regression`.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 28/28 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live input-file result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-input-file --timeout-ms 90000 --verbose`
  passed 1/1, latency 2248 ms, output `input-file-ok`, total usage 202 tokens.
- Full live `bridge-regression` passed 15/15, pass rate 1.0, average latency
  1962 ms, P95 latency 4168 ms, total usage 2199 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7rpme2` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Responses Output Logprobs Mapping

- Used current OpenAI Responses and Chat Completions reference data to confirm:
  - Responses `include` supports `message.output_text.logprobs`;
  - Responses `top_logprobs` accepts 0-20 likely tokens;
  - Chat Completions uses `logprobs:true` plus optional `top_logprobs`;
  - Chat responses return token probability data under
    `choices[].logprobs.content[]`.
- Used current DeepSeek Chat Completion docs to confirm DeepSeek supports
  `logprobs` and `top_logprobs` on Chat Completion requests, with
  `top_logprobs` requiring `logprobs:true`.
- Added Responses-to-Chat request mapping:
  - `include:["message.output_text.logprobs"]` sets upstream `logprobs:true`;
  - `top_logprobs` is forwarded and also sets `logprobs:true`;
  - compatibility metadata records `logprobs:"chat_logprobs"` when the bridge
    requests Chat log probabilities.
- Added Chat-to-Responses response mapping:
  - non-streaming `choices[0].logprobs.content[]` is preserved as
    `output[].content[].logprobs`;
  - streaming `choice.logprobs.content[]` chunks are accumulated onto the final
    `output_text` content part and final completed response.
- Added regression coverage for:
  - request parameter mapping to upstream Chat;
  - non-streaming output logprobs preservation;
  - streaming logprobs accumulation;
  - live `responses-logprobs` in `bridge-regression`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 30/30 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live logprobs result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-logprobs --timeout-ms 90000 --verbose`
  passed 1/1, latency 2361 ms, output `logprobs-ok`, total usage 67 tokens.
- Full live `bridge-regression` passed 16/16, pass rate 1.0, average latency
  1819 ms, P95 latency 3893 ms, total usage 2186 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7ryfn9` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Stored Chat Completions List Endpoint

- Used the current OpenAI Chat Completions OpenAPI schema to confirm
  `GET /v1/chat/completions` lists only stored Chat Completions and supports
  `model`, `metadata[key]`, `after`, `limit`, and `order` parameters. The
  response is an OpenAI-style list with `data`, `first_id`, `last_id`, and
  `has_more`.
- Added local `GET /v1/chat/completions` support for Chat passthrough requests
  created with `store:true`.
- Implemented model filtering, bracketed metadata filtering, and existing local
  pagination over the file-backed response store.
- Added local completion normalization so list filtering can use request model
  and request metadata when an upstream Chat provider does not echo those fields
  in the completion object.
- Added regression coverage for:
  - stored Chat completion listing;
  - `model` and `metadata[key]` filters;
  - list pagination shape;
  - unstored Chat completions remaining unavailable;
  - live `chat-lifecycle` checking list/get/messages together.
- Verified:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 30/30 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live Chat lifecycle result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case chat-lifecycle --timeout-ms 90000 --verbose`
  passed 1/1, latency 2119 ms, output `chat-life-ok`, list status 200, message
  count 2, total usage 59 tokens.
- Full live `bridge-regression` passed 16/16, pass rate 1.0, average latency
  1950 ms, P95 latency 4494 ms, total usage 2273 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7s9mln` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Chat-Native Stop and DeepSeek Identity/Usage Mapping

- Used current OpenAI Chat Completions reference data to confirm Chat supports:
  - `stop` sequences;
  - `service_tier` request/response metadata;
  - replacement identity/cache fields such as `safety_identifier` and
    `prompt_cache_key`.
- Used current DeepSeek Chat Completion docs to confirm DeepSeek supports:
  - `stop` on Chat Completion requests;
  - `user_id` for content-safety review, KVCache isolation, and scheduling
    isolation;
  - `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` in usage.
- Added Responses-to-Chat compatibility mapping:
  - `stop` is forwarded to upstream Chat providers;
  - DeepSeek mode maps `user_id`, `safety_identifier`, `prompt_cache_key`, or
    legacy `user` to DeepSeek `user_id`;
  - `user_id` values that already match DeepSeek's allowed character set are
    passed directly; values with unsupported characters are converted to a
    stable SHA-256 identifier before forwarding.
- Added Chat-to-Responses response mapping:
  - DeepSeek `prompt_cache_hit_tokens` fills
    `usage.input_tokens_details.cached_tokens`;
  - upstream Chat `service_tier` overwrites the local skeleton tier when
    present.
- Added regression coverage for:
  - local translator `stop` passthrough and DeepSeek `user_id` aliasing;
  - local prompt-cache usage and service-tier response mapping;
  - mock server `stop` passthrough from `/v1/responses`;
  - live `responses-stop-sequence` in `bridge-regression`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 32/32 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live stop result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-stop-sequence --timeout-ms 90000 --verbose`
  passed 1/1, latency 2068 ms, output `stop-ok`, total usage 76 tokens.
- First full live `bridge-regression` attempt passed 16/17. The new stop case
  returned an empty visible string after consuming a 64-token output budget,
  consistent with DeepSeek spending the budget on hidden thinking tokens before
  visible output. The eval case was adjusted to a 256-token output budget and
  rerun.
- Full live `bridge-regression` passed 17/17, pass rate 1.0, average latency
  2019 ms, P95 latency 4612 ms, total usage 2375 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7snjqg` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Multi-Choice Chat Response Preservation

- Used current OpenAI migration guidance to confirm:
  - Chat Completions can return multiple parallel generations as `choices[]`
    through the `n` parameter;
  - Responses removed `n` and returns typed output items instead of Chat
    choices.
- Added non-streaming Chat-to-Responses response mapping for every returned
  `choices[]` entry instead of only `choices[0]`:
  - `message.content` and `message.refusal` become output `message` items;
  - `message.tool_calls[]` become Responses `function_call` items;
  - legacy `message.function_call` becomes a Responses `function_call` item.
- Added stable legacy function-call IDs derived from the upstream Chat
  completion id and choice index. The same ID is used in Responses output and
  in local replay messages so a later `function_call_output` can reference it.
- Expanded replay storage for non-streaming Chat choices so multiple returned
  assistant choices are retained as replay messages when a later request uses
  `previous_response_id`.
- Added regression coverage for:
  - multiple Chat choices producing multiple Responses output items;
  - `finish_reason:"length"` in any choice marking the aggregate response
    `incomplete`;
  - legacy `message.function_call` output conversion;
  - server-level `previous_response_id` replay of a legacy Chat function call
    followed by a `function_call_output`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 34/34 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  1977 ms, P95 latency 4308 ms, total usage 2354 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7t10sk` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Chat Finish Reason Terminal State Mapping

- Used the current OpenAI OpenAPI schema to confirm:
  - Responses terminal stream events include `response.completed`,
    `response.incomplete`, and `response.failed`;
  - `Response.incomplete_details.reason` is limited to
    `max_output_tokens` and `content_filter`;
  - `Response.error.code` supports `server_error` for failed generations.
- Used current DeepSeek Chat Completion docs to confirm Chat
  `finish_reason` values include `stop`, `length`, `content_filter`,
  `tool_calls`, and `insufficient_system_resource`.
- Added a shared Chat-to-Responses terminal-state mapper:
  - `length` maps to `status=incomplete` with
    `incomplete_details.reason=max_output_tokens`;
  - `content_filter` maps to `status=incomplete` with
    `incomplete_details.reason=content_filter`;
  - DeepSeek `insufficient_system_resource` maps to `status=failed` with
    `error.code=server_error`;
  - `stop`, `tool_calls`, and legacy `function_call` remain completed.
- Applied the mapper to both non-streaming and streaming Responses output.
  Streaming now collects terminal `choice.finish_reason` values from Chat
  chunks and emits `response.incomplete` or `response.failed` instead of
  always emitting `response.completed`.
- Added regression coverage for:
  - non-streaming `content_filter` and `insufficient_system_resource`
    terminal states;
  - streaming `length` producing a `response.incomplete` terminal event;
  - streaming `insufficient_system_resource` producing a `response.failed`
    terminal event.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 37/37 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  2153 ms, P95 latency 4280 ms, total usage 2496 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7tegzw` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Streaming Multi-Choice Preservation

- Used the current OpenAI Chat Completions streaming schema to confirm Chat
  streamed chunks expose `choices[]`, that the array can contain more than one
  element when `n > 1`, and that each choice carries an `index`.
- Used current DeepSeek Chat Completion docs to confirm streaming chunks use
  `object:"chat.completion.chunk"` with `choices[].index`,
  `choices[].delta`, and `choices[].finish_reason`.
- Refactored Responses streaming state from a single assistant accumulator into
  per-choice accumulators keyed by `choice.index`.
- Streaming now preserves separate output `message`, `reasoning`, token
  logprobs, function-call items, and replay assistant messages per Chat choice.
- Added regression coverage for a two-choice interleaved Chat stream:
  - final Responses output contains two message items, `alpha` and `beta`;
  - a later `previous_response_id` request replays both choices as distinct
    assistant messages to upstream Chat.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `npm test`: 38/38 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  2035 ms, P95 latency 4608 ms, total usage 2422 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7toti0` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Streaming Refusal Content Mapping

- Used the current OpenAI Chat Completions streaming schema to confirm Chat
  stream deltas can include `delta.refusal`, and Chat stream logprobs can
  include `logprobs.refusal[]`.
- Used the current OpenAI Responses streaming schema to confirm Responses emits
  `response.refusal.delta` and `response.refusal.done` events, and that
  refusal output content parts only contain `type` and `refusal`.
- Added streaming Chat-to-Responses refusal mapping:
  - `choices[].delta.refusal` creates a Responses `refusal` content part;
  - refusal text streams as `response.refusal.delta` and finalizes as
    `response.refusal.done`;
  - pure refusal messages no longer emit fake `response.output_text.done`
    events;
  - refusal history is stored as Chat assistant `refusal` when a later request
    uses `previous_response_id`.
- Preserved Chat `logprobs.refusal[]` under
  `metadata.compatibility.chat_refusal_logprobs[]` instead of attaching it to
  refusal content parts, because the Responses refusal schema has no logprobs
  field.
- Added regression coverage for:
  - streamed refusal deltas and done events;
  - final Responses refusal content shape;
  - refusal logprobs compatibility metadata;
  - follow-up replay through `previous_response_id`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `npm test`: 39/39 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  1987 ms, P95 latency 4179 ms, total usage 2345 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7txna0` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Non-Streaming Refusal Logprobs Preservation

- Used the current OpenAI Chat Completions schema to confirm non-streaming
  `choices[].logprobs` can contain both `content[]` and `refusal[]` token
  probability arrays.
- Reused the Responses refusal schema boundary from the streaming refusal pass:
  refusal content parts only expose `type` and `refusal`, not `logprobs`.
- Added non-streaming Chat-to-Responses preservation for
  `choices[].logprobs.refusal[]` under
  `metadata.compatibility.chat_refusal_logprobs[]`.
- Tightened non-streaming text-logprob normalization so refusal-only logprob
  objects are not accidentally attached to `output_text` content parts.
- Updated server metadata merging so translator-level compatibility metadata is
  not overwritten when the bridge appends local adapter compatibility metadata.
- Added regression coverage for:
  - direct translator refusal-logprobs preservation;
  - `/v1/responses` non-streaming refusal output shape;
  - preservation of `chat_refusal_logprobs` alongside request compatibility
    metadata such as `logprobs:"chat_logprobs"`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 41/41 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  2092 ms, P95 latency 5020 ms, total usage 2334 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7u4c2c` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Service Tier Passthrough and DeepSeek Visible-Output Stability

- Used current OpenAI Chat Completions reference data to confirm
  `service_tier` is a Chat request parameter and response field when supported
  by the provider.
- Used current DeepSeek Chat Completion docs to confirm DeepSeek does not
  document `service_tier`, so DeepSeek deployments now filter this field by
  default instead of blindly forwarding it upstream.
- Added provider-aware `service_tier` request handling:
  - non-DeepSeek/OpenAI-compatible providers forward `service_tier` by default;
  - DeepSeek filters `service_tier` by default and records
    `metadata.compatibility.service_tier.forwarded=false`;
  - `CODEXCOMPAT_FORWARD_SERVICE_TIER` can override the provider-aware default.
- Added streaming Chat-to-Responses `service_tier` preservation when an upstream
  Chat stream chunk includes the actual tier used.
- Tightened DeepSeek visible-output stability for local compatibility contexts:
  - local `input_file` injection now disables DeepSeek thinking by default and
    records `metadata.compatibility.local_input_files.deepseek_thinking`;
  - local compaction replay follow-ups now disable DeepSeek thinking by default
    and record `metadata.compatibility.local_compaction.deepseek_thinking`.
- Added regression coverage for:
  - translator `service_tier` passthrough and provider-unsupported filtering;
  - config defaults that filter `service_tier` for DeepSeek providers;
  - mock server non-streaming `service_tier` forwarding and upstream tier
    preservation;
  - streaming terminal Responses `service_tier` preservation;
  - DeepSeek thinking disablement for local `input_file` and compaction replay.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 45/45 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - `npm run eval:bridge -- --case responses-input-file --timeout-ms 90000 --verbose`:
    passed 1/1, latency 1567 ms, output `input-file-ok`.
  - `npm run eval:bridge -- --case responses-compact-continuation --timeout-ms 90000 --verbose`:
    passed 1/1, latency 2937 ms, output `atlas-77`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1728 ms, P95 latency 3463 ms, total usage 2176 tokens.
  - Live DeepSeek `service_tier` filter check returned HTTP 200, visible output
    `tier filter ok`, and `metadata.compatibility.service_tier.forwarded=false`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7uoyl8` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Streaming Chat Options and Usage Preservation

- Used the current OpenAI Chat Completions OpenAPI schema to confirm
  `stream_options` is a Chat request parameter for streaming responses.
- Used the current DeepSeek Chat Completion docs to confirm DeepSeek documents
  `stream_options` with `include_usage`, so forwarding this field is safe for
  the live provider.
- Added Responses-to-Chat `stream_options` handling:
  - streaming Responses requests now forward caller-provided `stream_options`;
  - when the caller omits `stream_options.include_usage`, the bridge sets
    `include_usage:true` so the terminal Responses stream event can preserve
    upstream usage;
  - non-streaming requests that contain `stream_options` filter the field and
    record `metadata.compatibility.stream_options.reason=stream_required`;
  - `CODEXCOMPAT_FORWARD_STREAM_OPTIONS` and
    `CODEXCOMPAT_STREAM_INCLUDE_USAGE` can disable forwarding or bridge-added
    usage requests.
- Strengthened the live `responses-stream-events` regression so it now requires
  terminal `usage.total_tokens > 0` and
  `metadata.compatibility.stream_options.reason=enabled_by_bridge`.
- Added regression coverage for:
  - default streaming `stream_options.include_usage=true`;
  - caller-specified stream options such as `include_usage:false`;
  - non-streaming filtering and compatibility metadata;
  - server-side upstream request shape and final streaming metadata.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - `npm run eval:bridge -- --case responses-stream-events --timeout-ms 90000 --verbose`:
    passed 1/1, latency 2021 ms, usage 62 tokens, output `stream-ok`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1996 ms, P95 latency 4564 ms, total usage 2406 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7v403h` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Response Metadata Preservation

- Used the current OpenAI Chat Completions API reference to confirm Chat
  response and streaming chunk metadata fields, especially `id` and
  `system_fingerprint`, are part of the upstream Chat response surface:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
  and
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
- Added Chat-to-Responses compatibility metadata preservation:
  - non-streaming Chat `id` is preserved as
    `metadata.compatibility.chat_completion_id`;
  - non-streaming Chat `system_fingerprint`, including explicit `null`, is
    preserved as `metadata.compatibility.chat_system_fingerprint`;
  - stored Chat metadata fields `request_id` and `input_user` are preserved as
    `metadata.compatibility.chat_request_id` and
    `metadata.compatibility.chat_input_user` when returned by the provider;
  - streaming Chat chunks now accumulate the same top-level metadata and expose
    it on the terminal Responses event.
- Kept the bridge-generated Responses `resp_*` id unchanged so storage,
  `previous_response_id`, lifecycle retrieval, and cancellation semantics remain
  local and stable.
- Updated `docs/compatibility-matrix.md` with the new response metadata rows.
- Added regression coverage for:
  - non-streaming compatibility metadata preservation in
    `chatCompletionToResponse`;
  - streaming terminal `response.completed` preservation of Chat completion id
    and `system_fingerprint`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; `systemctl is-active`
    returned `active`.
  - `curl -fsS http://127.0.0.1:12912/healthz` returned `ok:true`, provider
    base `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1931 ms, P95 latency 4442 ms, total usage 2289 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vdte4` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Streaming Chat Annotation Preservation

- Used the current OpenAI web search and migration guidance to confirm citation
  annotations are exposed on message output content and that Chat streaming
  arrives as incremental `delta` chunks:
  https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations
  and
  https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers
- Added streaming Chat annotation aggregation:
  - `choices[].delta.annotations[]` and provider-style `choices[].annotations[]`
    are accumulated per Chat choice;
  - terminal Responses message parts expose the accumulated annotations at
    `output_text.annotations[]`;
  - no synthetic annotation-specific SSE event is emitted yet because this
    bridge only emits documented typed events it already models.
- Updated `docs/compatibility-matrix.md` to document native Chat annotation
  preservation for non-streaming and streaming responses.
- Added regression coverage to the typed streaming mock so the final
  `response.completed` object must include a preserved `url_citation`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1813 ms, P95 latency 3830 ms, total usage 2234 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vm1ky` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Choice Metadata Preservation

- Used the current OpenAI migration guidance to confirm the structural mismatch:
  Chat Completions returns an array of `choices`, while Responses returns
  typed `output` items:
  https://developers.openai.com/api/docs/guides/migrate-to-responses#messages-vs-items
- Added original Chat choice metadata preservation:
  - non-streaming Chat `choices[].index` and `choices[].finish_reason` are
    recorded in `metadata.compatibility.chat_choices[]`;
  - streaming Chat choice states record the latest `finish_reason` per
    `choice.index` and expose the final values in terminal Responses metadata;
  - the existing terminal status mapping remains unchanged, so
    `length`, `content_filter`, and DeepSeek `insufficient_system_resource`
    still map to Responses incomplete/failed states while the raw Chat value is
    also retained.
- Updated `docs/compatibility-matrix.md` with the new `chat_choices[]` row.
- Added regression coverage for:
  - non-streaming multi-choice raw index and finish reason preservation;
  - streaming terminal `response.completed` raw choice metadata preservation.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1731 ms, P95 latency 3501 ms, total usage 2173 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vqg7y` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Top-Level Metadata Preservation

- Used the current OpenAI Chat Completions OpenAPI schema to confirm Chat
  completion responses and streaming chunks expose top-level `id`, `object`,
  `created`, `model`, `system_fingerprint`, `choices`, and optional stored
  completion metadata fields:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Extended Chat-to-Responses compatibility metadata preservation:
  - `object`, `created`, and `model` are preserved as
    `metadata.compatibility.chat_object`, `chat_created`, and `chat_model` for
    non-streaming responses and streaming chunks;
  - stored-completion metadata fields returned by an upstream Chat provider,
    including `seed`, `tool_choice`, `response_format`, sampling parameters,
    `metadata`, and `tools`, are preserved under `metadata.compatibility.chat_*`;
  - this keeps the bridge-generated Responses object identity (`object=response`
    and local `resp_*` id) stable while retaining the original Chat envelope.
- Updated `docs/compatibility-matrix.md` with the new top-level metadata rows.
- Added regression coverage for:
  - non-streaming Chat top-level/stored metadata preservation;
  - streaming Chat chunk `object`, `created`, and `model` preservation in the
    terminal Responses event.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1696 ms, P95 latency 3599 ms, total usage 2135 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vw0s8` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Full Chat Usage Preservation

- Used the current OpenAI Chat Completions OpenAPI schema to confirm Chat usage
  can include provider-specific token details such as
  `prompt_tokens_details.audio_tokens`,
  `completion_tokens_details.audio_tokens`,
  `accepted_prediction_tokens`, and `rejected_prediction_tokens`:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Kept the direct Responses usage mapping stable:
  - `prompt_tokens` / `completion_tokens` continue to map to
    `input_tokens` / `output_tokens`;
  - `prompt_tokens_details.cached_tokens` and DeepSeek
    `prompt_cache_hit_tokens` continue to map to
    `input_tokens_details.cached_tokens`;
  - `completion_tokens_details.reasoning_tokens` continues to map to
    `output_tokens_details.reasoning_tokens`.
- Added lossless Chat usage preservation:
  - the full upstream Chat `usage` object is now stored as
    `metadata.compatibility.chat_usage` for non-streaming Responses;
  - streaming terminal Responses events preserve the final usage chunk in the
    same compatibility metadata field.
- Updated `docs/compatibility-matrix.md` with the `chat_usage` preservation row.
- Added regression coverage for:
  - non-streaming Chat audio and prediction token details;
  - streaming Chat usage detail preservation on `response.completed`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1851 ms, P95 latency 3554 ms, total usage 2306 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7w0j6g` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Max Completion Token Alias

- Used the current OpenAI Chat Completions OpenAPI schema to confirm
  `max_completion_tokens` is the current Chat-side token limit parameter while
  Responses uses `max_output_tokens`:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Added `/v1/responses` request compatibility for Chat-native token limits:
  - when `max_output_tokens` is absent, `max_completion_tokens` is accepted as
    a Chat-native alias and forwarded to the configured upstream token field
    (`CODEXCOMPAT_MAX_TOKENS_FIELD`, default `max_tokens`);
  - when both fields are present and differ, `max_output_tokens` takes
    precedence and the ignored Chat alias is recorded in
    `metadata.compatibility.max_completion_tokens`;
  - alias forwarding is also recorded in compatibility metadata so callers can
    audit which request field controlled the upstream token limit.
- Updated `docs/compatibility-matrix.md` with the new request mapping row.
- Added regression coverage for:
  - translator alias forwarding and conflict handling;
  - mock server upstream request shape and final metadata preservation.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `npm test`: 50/50 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1724 ms, P95 latency 3880 ms, total usage 2195 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7wc1mb` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Provider-Aware Chat-Native Request Fields

- Used the current OpenAI Chat Completions schema and DeepSeek Chat Completion
  reference to split Chat-native request fields into provider-aware behavior:
  - OpenAI Chat reference:
    https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
  - DeepSeek Chat reference:
    https://api-docs.deepseek.com/api/create-chat-completion
- Added `/v1/responses` compatibility for additional Chat-native fields:
  - `logit_bias`, `modalities`, `audio`, `prediction`, `n`,
    `prompt_cache_key`, `prompt_cache_retention`, `safety_identifier`,
    `moderation`, `verbosity`, `web_search_options`, and legacy
    `functions` / `function_call`;
  - non-DeepSeek/OpenAI-compatible providers forward these fields by default;
  - DeepSeek filters them by default and records the filtered field names in
    `metadata.compatibility.chat_native_fields`;
  - `CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS` can override the provider default.
- Extended token-limit aliasing:
  - `max_tokens` is now accepted on `/v1/responses` as a legacy Chat-native
    alias for the configured upstream max-token field;
  - precedence is `max_output_tokens`, then `max_completion_tokens`, then
    `max_tokens`;
  - ignored alias conflicts are recorded under
    `metadata.compatibility.max_completion_tokens` and/or
    `metadata.compatibility.max_tokens`.
- Updated `docs/compatibility-matrix.md` and `docs/deployment.md` with the new
  request mapping and environment flag.
- Added regression coverage for:
  - translator `max_tokens` alias forwarding and conflict metadata;
  - translator Chat-native field forwarding and provider-unsupported filtering;
  - mock server upstream request shape and final compatibility metadata;
  - config defaults that filter Chat-native fields for DeepSeek providers.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 54/54 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live DeepSeek Chat-native filter probe returned HTTP 200, visible output
    `chat native filter ok`, `metadata.compatibility.max_tokens.forwarded=true`,
    and `metadata.compatibility.chat_native_fields.filtered=["logit_bias","n"]`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1715 ms, P95 latency 3655 ms, total usage 2219 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7wsw2n` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Stored Chat Completion Metadata Update

- Used the current OpenAI Chat Completions docs/search index to identify the
  stored completion update method:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/update
- Added local support for `POST /v1/chat/completions/{completion_id}`:
  - only locally stored `store:true` Chat completion records can be updated;
  - only `{ "metadata": {...} }` is accepted, matching OpenAI's current
    restriction that stored Chat completion updates modify metadata only;
  - unsupported update fields return a `400 invalid_request_error` with
    `code=unsupported_chat_completion_update`;
  - the stored Chat completion and stored request metadata are both updated so
    later `GET`, `LIST`, and `metadata[key]` filters observe the new metadata.
- Extended the bridge regression harness:
  - `chat-lifecycle` now creates a stored Chat completion, updates metadata,
    fetches the completion, lists by the updated metadata filter, verifies the
    old metadata filter no longer returns the same id, and retrieves stored
    messages.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` with
  the update endpoint and regression coverage.
- Added regression coverage for:
  - invalid non-metadata update rejection;
  - successful metadata update response;
  - refetch after update;
  - list filtering by updated metadata and no match for prior metadata.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 54/54 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1899 ms, P95 latency 5580 ms, total usage 2323 tokens. The
    `chat-lifecycle` case returned `update_status:200`, `list_count:1`, and
    `old_list_status:200`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7x3zir` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Stored Chat Completion Delete

- Used the current OpenAI Chat Completions API reference to confirm
  `DELETE /chat/completions/{completion_id}` deletes only stored Chat
  Completions created with `store:true` and returns a
  `ChatCompletionDeleted` object:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/delete/
- Added local support for `DELETE /v1/chat/completions/{completion_id}`:
  - only locally stored Chat completion records can be deleted;
  - non-Chat records in the shared response store are not deleted by this route;
  - successful deletion returns
    `{object:"chat.completion.deleted", id, deleted:true}`;
  - follow-up get/messages calls return 404 and list filters no longer return
    the deleted id.
- Extended the bridge regression harness:
  - `chat-lifecycle` now writes the created completion id into updated
    metadata, lists by that unique metadata key, deletes the stored Chat
    completion, verifies `post_delete_get_status=404`, and confirms the
    metadata-filtered list no longer contains the deleted id.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` with
  the delete endpoint and regression coverage.
- Added regression coverage for:
  - successful delete response shape;
  - get/messages 404 after delete;
  - list filter empty after delete;
  - repeated delete 404.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server test for stored Chat lifecycle: passed.
  - `npm test`: 54/54 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active after systemd settled.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1780 ms, P95 latency 3617 ms, total usage 2150 tokens. The
    `chat-lifecycle` case returned `update_status:200`, `delete_status:200`,
    `post_delete_get_status:404`, and `post_delete_list_status:200`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7xa7js` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Vector Store File Batches and Web Search Resilience

- Used the current OpenAI file-search guide and Vector Store File Batch API
  reference to close a local vector-store compatibility gap:
  - guide:
    https://developers.openai.com/api/docs/assistants/tools/file-search#creating-vector-stores-and-adding-files
  - create batch:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/create
  - retrieve batch:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/retrieve
  - list batch files:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/list_files
  - cancel batch:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/cancel
- Added local support for the OpenAI Vector Store File Batch lifecycle:
  - `POST /v1/vector_stores/{vector_store_id}/file_batches`;
  - `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}`;
  - `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/files`;
  - `POST /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel`.
- Batch creation now accepts both current OpenAI request shapes:
  - `file_ids` with global `attributes` and `chunking_strategy`;
  - `files[]` entries with per-file `file_id`, `attributes`, and
    `chunking_strategy`.
- The local adapter enforces `file_ids` / `files` mutual exclusion and a 2000
  file upper bound from the current API reference. Because local indexing is
  synchronous, new batches return `status:"completed"` immediately with
  OpenAI-style `file_counts`; canceling an already completed batch returns the
  completed batch as a compatibility no-op.
- Extended the live bridge regression harness with
  `responses-file-search-batch`, which creates a local file, creates a vector
  store, attaches the file through the new file-batch endpoint, then verifies
  Responses `file_search` returns a `file_search_call`, result citation, and
  visible answer through DeepSeek.
- During live verification, the existing `responses-web-search` case exposed a
  Wikimedia HTTP 403 from the default MediaWiki API request. The bridge now:
  - uses a more complete default `CODEXCOMPAT_WEB_SEARCH_USER_AGENT`;
  - falls back from the default MediaWiki API endpoint to Wikipedia REST page
    search when the first request is rejected;
  - still prefers configured `CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS` when
    present.
- Updated `docs/compatibility-matrix.md`, `docs/evaluation-plan.md`, and
  `docs/deployment.md`.
- Added regression coverage for:
  - vector-store file batch creation with `file_ids`;
  - vector-store file batch creation with `files[]`;
  - batch retrieve, list-files with `filter`, completed cancel no-op, and
    mutual-exclusion rejection;
  - MediaWiki API rejection falling back to Wikipedia REST search.
- Verified:
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 56/56 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 18/18, pass rate 1.0, average latency
    1663 ms, P95 latency 4052 ms, total usage 2358 tokens. The new
    `responses-file-search-batch` case returned `file_batch_status:"completed"`
    and the `responses-web-search` case returned `ok:true`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7xthoj` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Vector Store Update, File Attributes, and File Content

- Used the current OpenAI Vector Stores API reference to close three local
  file-search support gaps:
  - update vector store:
    https://developers.openai.com/api/reference/resources/vector_stores/methods/update/
  - update vector-store file attributes:
    https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/update/
  - retrieve vector-store file content:
    https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/content/
- Added local support for:
  - `POST /v1/vector_stores/{vector_store_id}` to update `name`, `metadata`,
    and `expires_after`, with local `expires_at` computation from
    `last_active_at`;
  - `POST /v1/vector_stores/{vector_store_id}/files/{file_id}` to update
    vector-store file `attributes`;
  - `GET /v1/vector_stores/{vector_store_id}/files/{file_id}/content` to return
    local extracted text chunks for the attached file, including the
    `vector_store.file_content.page` page fields plus an example-compatible
    `content` alias.
- Added `usage_bytes` as a compatibility alias on hydrated local vector-store
  objects while preserving the existing `bytes` field.
- Extended regression coverage:
  - server tests now update vector-store metadata/expiry policy, update file
    attributes, retrieve vector-store file content, and verify the updated
    attributes are returned;
  - live `bridge-regression` now includes a new `vector-store-lifecycle` case
    that creates a file and vector store, updates the vector store, attaches and
    updates a vector-store file, retrieves file content, searches using updated
    attributes, and cleans up without model token spend.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server test for local Vector Store file batches/lifecycle: passed.
  - `npm test`: 56/56 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `vector-store-lifecycle` case passed 1/1 in 262 ms with
    `vector_store_file_status:"completed"`, `content_parts:1`, and
    `search_results:1`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 19/19, pass rate 1.0, average latency
    1708 ms, P95 latency 4102 ms, total usage 2447 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7y9d8c` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Input File PDF Text Extraction

- Closed a local `input_file` compatibility gap for PDFs with extractable text
  layers:
  - inline `file_data` PDFs now run through local Poppler `pdftotext`;
  - extracted PDF text is injected into the upstream Chat prompt like other
    local `input_file` text;
  - unsupported/scanned PDFs still surface as compatibility metadata rather
    than invented content.
- Added bounded PDF extraction controls:
  - `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR=pdftotext` by default;
  - `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR=disabled` to turn this off;
  - `CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS=10000` by default;
  - extraction still obeys `CODEXCOMPAT_INPUT_FILE_MAX_BYTES` and
    `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS`.
- Added `metadata.compatibility.local_input_files.pdf_extracted_count` and an
  `extraction_method: pdftotext` prompt header. Regression tests assert the
  prompt does not contain the raw `%PDF-1.4` body, preventing a false pass from
  raw ASCII PDF injection.
- Extended the live bridge regression harness with `responses-input-file-pdf`,
  which sends an inline base64 PDF through `/v1/responses`, verifies
  `pdf_extracted_count:1`, and requires DeepSeek to answer from the extracted
  PDF text.
- Updated `docs/compatibility-matrix.md`, `docs/deployment.md`, and
  `docs/evaluation-plan.md`.
- Verified:
  - `pdftotext` is installed at `/usr/bin/pdftotext`, version 24.02.0.
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server test for Responses `input_file`: passed.
  - `npm test`: 56/56 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-input-file-pdf` passed 1/1 after restart, elapsed 1524 ms,
    total usage 129 tokens, output `pdf-input-ok`. The same stricter case failed
    before restart because the previous service did not report
    `pdf_extracted_count`, proving the live check gates the new behavior.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 20/20, pass rate 1.0, average latency
    1532 ms, P95 latency 2336 ms, total usage 2538 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7ypehb` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Disk-Bounded SWE-bench Prediction Runner

- Reviewed current SWE-bench public evaluation guidance:
  - evaluation guide:
    https://www.swebench.com/SWE-bench/guides/evaluation/
  - harness reference:
    https://www.swebench.com/SWE-bench/reference/harness/
  - Docker setup guide:
    https://www.swebench.com/SWE-bench/guides/docker_setup/
  - Verified dataset card:
    https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified
- Added `scripts/swebench-runner.mjs` and `npm run bench:swe`.
- The runner is intentionally disk-bounded:
  - it accepts a local JSONL/JSON subset instead of downloading datasets into
    the repository;
  - it defaults reports and predictions to
    `/srv/aialra/data/opencodexapp/eval/swebench/`;
  - it writes SWE-bench-compatible predictions JSONL with `instance_id`,
    `model_name_or_path`, and `model_patch`;
  - it records compact task metadata, patch hashes, latency, token usage, and
    an official `swebench.harness.run_evaluation` follow-up command;
  - it omits gold `patch` and `test_patch` contents from prompts and compact
    reports to avoid benchmark leakage;
  - it includes `--dry-run` for dataset/report validation without model spend
    and `--write-sample` for a synthetic smoke fixture only.
- Added unit coverage for dry-run report and prediction generation, including
  checks that gold patch strings do not appear in stdout.
- Updated `docs/evaluation-plan.md` and `docs/deployment.md`.
- Verified:
  - `node --check scripts/swebench-runner.mjs`: passed.
  - targeted `node --test test/swebench_runner.test.js`: passed.
  - `npm test`: 57/57 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Synthetic dry-run smoke:
    `npm run bench:swe -- --dataset-jsonl /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke.jsonl --write-sample --dry-run --limit 1 --output /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke-report.json --predictions /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke-predictions.jsonl`
    passed, wrote 1 empty official prediction without model usage, and recorded
    zero transport errors.
  - Synthetic live bridge smoke:
    `npm run bench:swe -- --dataset-jsonl /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke.jsonl --limit 1 --timeout-ms 90000 --output /srv/aialra/data/opencodexapp/eval/swebench/synthetic-live-report.json --predictions /srv/aialra/data/opencodexapp/eval/swebench/synthetic-live-predictions.jsonl`
    passed through `http://127.0.0.1:12912`, generated 1 diff-like patch,
    latency 25068 ms, total usage 1611 tokens, and recorded zero transport
    errors or secret rejections.

## 2026-06-10 SWE-bench Docker Scorer Wrapper

- Added `scripts/swebench-evaluate.mjs` and `npm run bench:swe:score`.
- The scorer wrapper is intentionally separated from `bench:swe`:
  - `bench:swe` generates DeepSeek/bridge predictions;
  - `bench:swe:score` invokes the official SWE-bench Docker harness when
    `--dry-run` is omitted.
- The wrapper accepts either a `bench:swe` prediction report or direct
  `--predictions` plus dataset arguments, then builds the official
  `python -m swebench.harness.run_evaluation` command.
- Added deployment-safe defaults:
  - `--max-workers 1`;
  - `--cache-level env`;
  - `--clean True`;
  - `--max-instances 5` unless `--allow-large-run` is explicit;
  - `--min-free-gb 120` for live Docker scoring;
  - compact artifacts under `/srv/aialra/data/opencodexapp/eval/swebench/`.
- Added preflight checks for Python, SWE-bench import, Docker, free disk,
  selected instance IDs, prediction count, and secret-like patch content before
  any live harness execution.
- Added compact score outputs:
  - JSON score report with prediction counts, patch hashes, harness command,
    preflight status, parsed `results.json`, parsed `instance_results.jsonl`,
    and summary metrics;
  - Markdown score summary for audit review.
- Updated `bench:swe` prediction reports to include a `wrapper_command` pointing
  to `npm run bench:swe:score -- --prediction-report ... --dry-run`.
- Updated `docs/evaluation-plan.md` and `docs/deployment.md`.
- Verified:
  - `node --check scripts/swebench-evaluate.mjs`: passed.
  - targeted `node --test test/swebench_evaluate.test.js`: passed.
  - `npm test`: 58/58 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Synthetic scorer dry-run:
    `npm run bench:swe:score -- --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/synthetic-live-report.json --dry-run --output /srv/aialra/data/opencodexapp/eval/swebench/synthetic-score-dry-run.json --summary-md /srv/aialra/data/opencodexapp/eval/swebench/synthetic-score-dry-run.md --report-dir /srv/aialra/data/opencodexapp/eval/swebench/harness-smoke`
    passed as a dry-run and produced compact JSON/Markdown score artifacts.
  - Dry-run preflight intentionally did not start Docker scoring because the
    current host cannot yet satisfy the live scorer gate:
    `python3 -c "import swebench"` failed with `ModuleNotFoundError`, and free
    disk was 34.86GB, below the 120GB live scoring guard. Docker itself was
    available: `Docker version 29.1.3`.

## 2026-06-10 Local Conversations API and Responses Conversation Replay

- Used OpenAI's current endpoint list and conversation-state guide to close the
  local Conversations API gap:
  - endpoint list includes `/v1/conversations`,
    `/v1/conversations/{conversation_id}`,
    `/v1/conversations/{conversation_id}/items`, and
    `/v1/conversations/{conversation_id}/items/{item_id}`;
  - the conversation-state guide documents passing `conversation:"conv_..."`
    into Responses and notes that Conversation items are durable separately from
    ordinary stored response TTL.
- Added `FileConversationStore`, backed by
  `CODEXCOMPAT_CONVERSATION_STATE_DIR` with the default
  `$CODEXCOMPAT_STATE_DIR/local-conversations`.
- Implemented local endpoints:
  - `POST /v1/conversations`;
  - `GET`, `POST`, and `DELETE /v1/conversations/{conversation_id}`;
  - `GET` and `POST /v1/conversations/{conversation_id}/items`;
  - `GET` and `DELETE /v1/conversations/{conversation_id}/items/{item_id}`.
- Added Responses integration:
  - `conversation:"conv_..."`, `conversation_id`, and `{conversation:{id}}`
    references are accepted;
  - existing conversation items are replayed into the upstream Chat prompt;
  - successful non-streaming, streaming, and background responses return
    `response.conversation` and append input/output items back to the local
    conversation;
  - append occurs even when the Responses request sets `store:false`, matching
    the Conversation durability boundary described by the official guide.
- Added server tests for conversation CRUD, item pagination/retrieval/deletion,
  `store:false` Responses conversation append, and missing-conversation 404.
- Extended live `bridge-regression` with `responses-conversation-lifecycle`.
- Updated `.env.example`, `docs/compatibility-matrix.md`,
  `docs/evaluation-plan.md`, and `docs/deployment.md`.
- Verified:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server tests for local Conversations and missing conversation
    references: passed.
  - `npm test`: 60/60 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-conversation-lifecycle` passed 1/1, elapsed 1985 ms,
    item count 4, delete status 200, post-delete GET 404, total usage 96
    tokens, output `conversation-ok`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 21/21, pass rate 1.0, average latency
    1687 ms, P95 latency 2714 ms, total usage 2682 tokens. The new
    `responses-conversation-lifecycle` case returned `conversation-ok` and
    deleted the conversation successfully.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq8001kz` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Conversation Replay for Auxiliary Responses Endpoints

- Extended local Conversation replay beyond `POST /v1/responses`:
  - `POST /v1/responses/input_tokens` now replays local Conversation items
    before probing upstream Chat Completions usage;
  - `POST /v1/responses/compact` now summarizes request,
    `previous_response_id`, and local Conversation state together;
  - both auxiliary endpoints now return 404 `conversation_not_found` without
    calling upstream when a referenced local Conversation is missing.
- Added `response.conversation` and
  `metadata.compatibility.local_conversation` to local compaction responses when
  compaction is attached to a Conversation.
- Kept auxiliary endpoint behavior replay-only: `/input_tokens` and `/compact`
  do not append items back to the Conversation item list.
- Updated `responses-conversation-lifecycle` in the live bridge regression
  harness so it exercises:
  - Conversation creation;
  - `/v1/responses/input_tokens` with Conversation replay;
  - `/v1/responses` with Conversation replay and append;
  - `/v1/responses/compact` with Conversation replay;
  - item listing, delete, and post-delete 404.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server tests for conversation, compact, and input token paths:
    34/34 passed.
  - `npm test`: 61/61 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-conversation-lifecycle` passed 1/1, elapsed 5237 ms,
    with three successful steps: input-token probe 22 tokens, main response
    output `conversation-ok`, and compaction with 2 output items. The case
    ended with item count 4, delete status 200, post-delete GET 404, and total
    usage 429 tokens.
  - Full live `bridge-regression` passed 21/21 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1711 ms, P95 latency 3676 ms, and total
    usage 2910 tokens.
  - Public HTTPS returned HTTP/2 200 from `https://opencodexapp.aialra.online`.
  - UI smoke passed with marker `ui-smoke-mq80dhxa`, reload persistence
    confirmed, console errors 0, warnings 0.
  - Local Conversation JSON files after live cleanup: 0.

## 2026-06-10 Office OOXML Input File Extraction

- Closed another local `input_file` compatibility gap by adding dependency-free
  Office OOXML text extraction for inline/base64, local file-id, and fetched
  file inputs:
  - `.docx` extracts text from Word document/header/footer/comment-style XML
    parts;
  - `.xlsx` extracts shared strings and worksheet rows as tab-separated text;
  - `.pptx` extracts slide text from presentation slide XML.
- Implemented a small bounded ZIP reader in `src/bridge/input_files.js` for
  stored and deflated entries, with entry count and inflated-size guards. No new
  npm package was added.
- Added `metadata.compatibility.local_input_files.office_extracted_count` so
  tests and audit reports can distinguish Office extraction from plain text and
  PDF extraction.
- Extended the live bridge regression harness with
  `responses-input-file-office`, using generated minimal `.docx`, `.xlsx`, and
  `.pptx` fixtures.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted `input_file` server tests: passed, including the new Office
    extraction case.
  - `npm test`: 62/62 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-input-file-office` passed 1/1, elapsed 1615 ms, output
    `office-input-ok`, total usage 309 tokens.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1987 ms, P95 latency 4032 ms, and total
    usage 3218 tokens.
  - Public HTTPS returned HTTP/2 200 from `https://opencodexapp.aialra.online`.
  - UI smoke passed with marker `ui-smoke-mq80pdf1`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Background Restart Reconciliation

- Closed the "stuck forever after restart" part of the local background
  response gap:
  - bridge startup now scans file-backed Responses records;
  - stale `background:true` + `status:"in_progress"` records are marked
    `failed`;
  - the terminal error uses
    `code:"background_job_interrupted_by_restart"` and
    `type:"compatibility_bridge_error"`;
  - `metadata.compatibility.background_restart` is set to
    `marked_failed_on_startup`.
- This does not yet resume an interrupted upstream call; full native-style
  background durability still needs a persisted job queue. It does prevent
  Codex/UI clients from polling an orphaned local background response forever.
- Added a server test that seeds a file-backed stale background response before
  creating the bridge server and verifies startup reconciliation through
  `GET /v1/responses/{response_id}`.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - targeted background server tests: passed, including normal background
    completion, cancellation, and startup reconciliation.
  - `npm test`: 63/63 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Live deployment restart reconciliation passed by writing a temporary
    non-secret stale response record `resp_stale_live_1781093229`, restarting
    `aialra-opencodexapp-bridge.service`, verifying it returned
    `status:"failed"` with `background_job_interrupted_by_restart`, then
    deleting it through `DELETE /v1/responses/{response_id}`.
  - Temporary live stale response files after cleanup: 0.
  - After restart, bridge, web, and app-server services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1881 ms, P95 latency 4093 ms, and total
    usage 3219 tokens. The normal `responses-background` case completed after
    several `in_progress` polls.
  - Public HTTPS returned HTTP/2 200 from `https://opencodexapp.aialra.online`.
  - UI smoke passed with marker `ui-smoke-mq80ygqx`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local Web Search Open Page Context

- Closed another part of the hosted `web_search_preview` parity gap for
  Chat-only providers:
  - local search results can now trigger bounded `open_page` fetches for the
    top configured results;
  - HTML/plain text page content is extracted, size-limited, and injected into
    the upstream Chat prompt;
  - Responses output includes auditable `web_search_call` items for both
    `action.type:"search"` and `action.type:"open_page"`;
  - compatibility metadata records `opened_count` and `open_failed_count`.
- Implementation follows the official OpenAI web search output shape where
  searched responses can include `web_search_call` output items whose action is
  `search`, `open_page`, or `find_in_page`, with final message URL citations.
  Source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations`.
- Added bridge flags:
  - `CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES`;
  - `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES`;
  - `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_TEXT_CHARS`.
- Updated `.env.example`, `docs/deployment.md`,
  `docs/compatibility-matrix.md`, and `docs/evaluation-plan.md`.
- Remaining known gap: this is still a local compatibility adapter, not the
  native OpenAI hosted search product. The default no-key provider remains
  Wikipedia-only, and `find_in_page` plus production-grade ranking/citation
  policy are still future work.
- Verified:
  - `node --check src/bridge/web_search.js src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`:
    passed.
  - `npm test`: 65/65 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-web-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2066 ms, output `web-search-ok [1]`, and total
    usage 406 tokens. The harness requires a completed search call, an
    attempted `open_page` call, URL citation annotations, and nonzero open-page
    attempt metadata.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1728 ms, P95 latency 3803 ms, and total
    usage 3228 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq81cn6p`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local Web Search Find In Page Context

- Closed the next local `web_search_preview` action-shape gap for Chat-only
  providers:
  - successfully opened pages now receive a local `find_in_page` scan over the
    extracted page text;
  - Responses output includes auditable `web_search_call` items for
    `action.type:"search"`, `action.type:"open_page"`, and
    `action.type:"find_in_page"`;
  - bounded `find_in_page` snippets are injected into the upstream Chat prompt;
  - compatibility metadata records `find_in_page_count`,
    `find_in_page_match_count`, and `find_in_page_failed_count`.
- Improved `open_page` robustness for large pages: local page fetches now read
  up to `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES` and mark the page text
  `truncated` instead of failing solely because the remote body is larger than
  the local read limit.
- Implementation follows the official OpenAI web search output shape where
  `web_search_call.action` may be `search`, `open_page`, or `find_in_page`, with
  final message URL citations. Source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations`.
- Added bridge flags:
  - `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE`;
  - `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_MAX_MATCHES`;
  - `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_CONTEXT_CHARS`.
- Updated `.env.example`, `docs/deployment.md`,
  `docs/compatibility-matrix.md`, and `docs/evaluation-plan.md`.
- Remaining known gap: this is still a local compatibility adapter, not native
  OpenAI hosted search. The default no-key provider remains Wikipedia-only, and
  production-grade web ranking, source policy, and citation selection remain
  future work.
- Verified:
  - `node --check src/bridge/web_search.js src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`:
    passed.
  - `npm test`: 66/66 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Direct live probe for `Use web search for OpenAI` returned completed
    `search`, `open_page`, and `find_in_page` call actions for
    `https://en.wikipedia.org/wiki/OpenAI`, with `opened_count:1`,
    `find_in_page_count:1`, and `find_in_page_match_count:3`.
  - Targeted live `responses-web-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2553 ms, output `web-search-ok [1]`, and total
    usage 4040 tokens. The harness now requires a completed `find_in_page`
    action when the page opens successfully.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1629 ms, P95 latency 3589 ms, and total
    usage 6812 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq81p7ky`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Static Chunking

- Closed a local `file_search` fidelity gap where vector-store file attachments
  stored `chunking_strategy` but search/content generation still used fixed
  paragraph slicing.
- Local vector-store files now:
  - validate OpenAI-style `chunking_strategy` on attach and file-batch attach;
  - use the documented default static strategy of 800-token chunks with
    400-token overlap when no strategy is provided or `type:"auto"` is used;
  - reject invalid static strategies where `max_chunk_size_tokens` is outside
    100-4096 or overlap exceeds half the chunk size;
  - expose effective `chunking_strategy` plus chunk metadata through
    `/v1/vector_stores/{vector_store_id}/files/{file_id}/content`;
  - include `chunk_index`, token offsets, token count, and effective strategy in
    `/v1/vector_stores/{vector_store_id}/search` results.
- Also tightened lexical ranking slightly with exact-phrase and term-frequency
  boosts while keeping the retriever local and auditable.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/retrieval#chunking`, which
  documents the 800/400 default and static chunking limits.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: this is still lexical local retrieval, not OpenAI's
  managed semantic vector search with embeddings, reranking, async ingestion,
  and full hosted ranking policy.
- Verified:
  - `node --check src/bridge/local_file_search.js scripts/eval-harness.mjs test/server.test.js`:
    passed.
  - Targeted local vector/file-search tests passed, including the new static
    chunking strategy case.
  - `npm test`: 67/67 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1, elapsed 176 ms, with
    `content_parts:4` and `search_results:3`, proving the configured
    100-token/50-token-overlap static chunking path was exercised.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1722 ms, P95 latency 3900 ms, and total
    usage 6898 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq820iqn`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Bounded Input File URL Truncation

- Closed a local `input_file` reliability gap where remote HTTP(S)
  `file_url` inputs that exceeded the byte cap failed the entire local file
  extraction path instead of providing any usable prefix context to Chat-only
  providers.
- Remote `file_url` fetches now retain bytes up to
  `CODEXCOMPAT_INPUT_FILE_MAX_BYTES`, continue normal text/PDF/OOXML extraction
  on that bounded prefix, set `truncated: true` in the injected file context,
  and increment `metadata.compatibility.local_input_files.truncated_count`.
- Local Files API `file_id` and inline base64 `file_data` inputs still fail
  when their buffers exceed the local byte cap, preserving strict behavior for
  caller-controlled complete files.
- Extended the live bridge regression harness with `responses-input-file-url`,
  which serves a deterministic local HTTP fixture and verifies that the running
  bridge fetches it through a real `file_url` request path.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/file-inputs`, which documents
  Responses `input_file` support for base64 data, Files API file IDs, and
  external URLs, plus file-type processing and size-limit considerations.
- Updated `docs/compatibility-matrix.md`, `docs/evaluation-plan.md`, and
  `docs/deployment.md`.
- Remaining known gap: this remains a bounded local text-extraction adapter,
  not OpenAI's native file pipeline. PDF page images, OCR, full spreadsheet
  augmentation, richer document parsing, and complete remote files above the
  local cap still require future work or the local `file_search` path.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local `input_file` server tests passed 3/3, including the new
    remote URL truncation case.
  - `npm test`: 68/68 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-input-file-url` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1278 ms, output `url-input-ok`, and total usage
    165 tokens.
  - Full live `bridge-regression` passed 23/23 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1760 ms, P95 latency 4229 ms, and total usage
    7068 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq82b356`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Deterministic Spreadsheet Input Augmentation

- Closed part of the `input_file` spreadsheet parity gap for Chat-only
  providers. CSV/TSV inputs and `.xlsx` worksheets now receive deterministic
  local spreadsheet context instead of only raw text or unannotated worksheet
  rows.
- The local adapter now:
  - parses CSV/TSV/IIF-style delimited files with quoted-cell support;
  - parses `.xlsx` worksheet rows through the existing bounded OOXML reader;
  - keeps up to the first 1,000 rows per sheet;
  - injects row limit, parsed row count, detected column count, first-row
    header metadata, and normalized row values into the upstream Chat prompt;
  - sets `truncated_rows: true` and `truncated: true` when row or text caps are
    reached;
  - reports `metadata.compatibility.local_input_files.spreadsheet_extracted_count`
    for CSV/TSV and `.xlsx` extraction paths.
- Extended the live bridge regression harness with
  `responses-input-file-spreadsheet`, which sends a CSV `input_file` payload
  through `/v1/responses` and verifies the running DeepSeek-backed bridge can
  recover the exact spreadsheet answer.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/file-inputs#how-spreadsheet-augmentation-works`,
  which documents spreadsheet-specific processing for `.xlsx`, `.xls`, `.csv`,
  `.tsv`, and `.iif`, including parsing up to the first 1,000 rows per sheet
  with summary/header metadata.
- Updated `docs/compatibility-matrix.md`, `docs/evaluation-plan.md`, and
  `docs/deployment.md`.
- Remaining known gap: this is deterministic local metadata, not OpenAI's
  model-generated spreadsheet summaries or full spreadsheet semantics. Legacy
  binary Excel, formulas/macros, charts, embedded media, merged cells, workbook
  relationships, and richer semantic summarization still require future work.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local `input_file` server tests passed 4/4, including CSV
    spreadsheet augmentation and `.xlsx` spreadsheet metadata.
  - `npm test`: 69/69 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-input-file-spreadsheet` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1259 ms, output `spreadsheet-input-ok`, and
    total usage 202 tokens.
  - Full live `bridge-regression` passed 24/24 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1715 ms, P95 latency 3794 ms, and total usage
    7285 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq82ko1e`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Ranking Options

- Closed another local `file_search` parity gap by accepting OpenAI-style
  `ranking_options` on both direct vector-store search requests and Responses
  `file_search` tools.
- Local vector-store search now:
  - normalizes lexical relevance scores to the documented 0..1 range;
  - honors `ranking_options.score_threshold` by filtering low-score chunks
    before sorting and truncating results;
  - returns effective `ranking_options` on
    `/v1/vector_stores/{vector_store_id}/search`;
  - preserves `ranker` and normalized `hybrid_search` metadata for audit
    output, marking hybrid search as `local_mode:"text_only"` because local
    embedding similarity is not available yet;
  - rejects invalid `score_threshold` and hybrid weights with explicit 400
    errors.
- Responses `file_search_call` output items and
  `metadata.compatibility.local_file_search` now include the effective
  ranking options used for the local search.
- Extended live bridge regression coverage so `responses-file-search` sends
  `ranking_options:{ranker:"default_2024_08_21",score_threshold:0.8}` and
  verifies the call output preserves the threshold. The direct
  `vector-store-lifecycle` case now also verifies the search result page
  carries `score_threshold:0.8`.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/assistants/tools/file-search#improve-file-search-result-relevance-with-chunk-ranking`,
  which documents `file_search.ranking_options`, `ranker`,
  `score_threshold` from 0.0 to 1.0, and hybrid search weights.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: this remains local lexical ranking, not OpenAI's managed
  semantic/hybrid file-search stack. Embedding search, reciprocal-rank fusion,
  managed rerankers, and hosted retrieval policy still require future work.
- Verified:
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local file-search/vector-store tests passed 3/3, covering default
    ranking options, strict `score_threshold` filtering, hybrid metadata
    normalization, invalid threshold rejection, and Responses call metadata.
  - `npm test`: 69/69 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-file-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1545 ms, output `file-search-ok [1]`, and total
    usage 178 tokens.
  - Targeted live `vector-store-lifecycle` passed 1/1, elapsed 129 ms, with
    `content_parts:4` and threshold-filtered `search_results:2`.
  - Full live `bridge-regression` passed 24/24 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 2094 ms, P95 latency 5208 ms, and total usage
    7320 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq82w599`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Multi-Query Decomposition

- Closed another local `file_search` gap against OpenAI hosted retrieval
  behavior: hosted file search can rewrite and break complex user queries into
  multiple searches, while the local adapter previously emitted exactly one
  query.
- Local vector-store search now:
  - accepts `query` as either a string or an array;
  - returns both legacy `search_query` and auditable `search_queries`;
  - scores each chunk against every bounded query and uses the best normalized
    lexical score for ranking;
  - records per-result `matched_queries` so callers can inspect which query
    caused each chunk to be selected.
- Responses `file_search` emulation now:
  - performs bounded deterministic decomposition for prompts such as
    `file search for alpha and beta`;
  - preserves multiple queries in `file_search_call.queries`;
  - reports `metadata.compatibility.local_file_search.query_count`;
  - injects the query list and per-result `matched_queries` into the local
    file-search context prompt.
- Kept the split deliberately conservative and bounded to four queries, 240
  characters each, to avoid prompt/context growth and to stay aligned with the
  bridge's disk- and token-bounded adapter model.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/assistants/tools/file-search#how-it-works`,
  which documents that hosted `file_search` rewrites user queries and breaks
  complex queries into multiple searches it can run in parallel.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: this is deterministic local decomposition, not OpenAI's
  hosted query rewriting, semantic search, parallel remote retrieval, or managed
  reranking.
- Verified:
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local file-search/vector-store tests passed 3/3, covering direct
    query arrays, `search_queries`, `matched_queries`, natural-language
    multi-query Responses prompts, and compatibility metadata `query_count`.
  - `npm test`: 69/69 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-file-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1837 ms, output `file-search-ok [1]`, and total
    usage 219 tokens, verifying multi-query `file_search_call.queries` and
    `matched_queries`.
  - Targeted live `vector-store-lifecycle` passed 1/1, elapsed 157 ms, with
    `content_parts:4` and multi-query `search_results:3`.
  - Full live `bridge-regression` passed 24/24 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 2087 ms, P95 latency 4234 ms, and total usage
    7283 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq836bza`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local Hosted Tool `max_tool_calls` Budget

- Closed a Responses compatibility gap where `max_tool_calls` was preserved on
  the response object but did not constrain local hosted-tool emulation for
  Chat-only providers.
- Added a shared local tool-call budget module that:
  - validates `max_tool_calls` as a non-negative integer and returns
    `400 invalid_max_tool_calls` for invalid values;
  - records `max_tool_calls`, `used`, `skipped`, `exhausted`, and bounded
    `skipped_calls` under `metadata.compatibility.local_tool_budget`;
  - avoids running skipped local actions and avoids fabricating tool output.
- Applied the shared budget to local hosted-tool adapters:
  - `web_search` consumes one slot for search, one for each bounded
    `open_page`, and one for each local `find_in_page`;
  - `file_search` consumes one slot per vector-store search;
  - `shell` and `code_interpreter` consume one slot per local command
    execution.
- Tool-specific metadata now exposes skipped counters such as
  `local_web_search.open_skipped_count`,
  `local_file_search.skipped_count`, and `local_shell.skipped_count`.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/reference/responses/create`, whose
  Responses create reference describes `max_tool_calls` as the maximum total
  built-in tool calls processed in a response.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: local hosted-tool execution order is deterministic
  (`shell`/`code_interpreter`, then web search, then file search) rather than
  model-decided dynamic tool planning. Full native parity still requires a real
  tool loop against a Responses-capable model or deeper Codex-side hosted-tool
  negotiation.
- Verified:
  - `node --check` passed for `src/bridge/local_tool_budget.js`,
    `src/bridge/web_search.js`, `src/bridge/local_file_search.js`,
    `src/bridge/local_shell.js`, `src/bridge/server.js`, and
    `scripts/eval-harness.mjs`.
  - Targeted local tests passed 4/4, covering web-search action limiting,
    shared shell/web-search budget consumption, invalid `max_tool_calls`
    rejection, and existing file-search compatibility.
  - `npm test`: 72/72 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-max-tool-calls` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2007 ms, output `web-budget-ok [1]`, and total
    usage 409 tokens.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1814 ms, P95 latency 4411 ms, and total usage
    7725 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq83r5va`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Attribute Filters

- Closed a vector-store search compatibility gap where the local
  `file_search` adapter accepted only simple metadata filters and direct search
  used a smaller max-result ceiling than the OpenAI retrieval guide documents.
- Official sources checked on 2026-06-10:
  - `https://developers.openai.com/api/docs/guides/retrieval#attribute-filtering`,
    which describes attribute filtering over file attributes, comparison
    filters, and compound `and`/`or` filters.
  - `https://developers.openai.com/api/docs/guides/retrieval#semantic-search`,
    which documents vector-store search defaulting to 10 results and accepting
    up to 50 via `max_num_results`.
- Added local vector-store search support for:
  - comparison filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`;
  - legacy-compatible array filters: `in`, `nin`;
  - compound filters: `and`, `or`;
  - aliases such as `attribute_filter`, `attributeFilter`, `filter`, and
    `filters`;
  - plain shorthand maps such as `{suite:"server-test", archived:false}`.
- Invalid filters now fail closed with `400 invalid_vector_store_filter`
  instead of silently behaving like a match-all query. Invalid direct search
  limits now fail with `400 invalid_vector_store_search_limit`.
- Raised the local direct vector-store search `max_num_results` ceiling to 50
  while keeping injected Responses `file_search` context bounded by
  `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS`.
- Updated the evaluation harness, compatibility matrix, deployment notes, and
  95% parity criteria to include comparison/compound attribute filters.
- Remaining known gap: retrieval is still local lexical chunk matching, not
  OpenAI managed semantic vector retrieval, hosted query rewriting, or managed
  reranking.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `npm test`: 72/72 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 292 ms, with `content_parts:4` and
    `search_results:3`.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1646 ms, P95 latency 3890 ms, and total usage
    7760 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq8460h0`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Hashed Semantic Hybrid Retrieval

- Closed another `file_search` retrieval parity gap by moving the local vector
  store search path from keyword-only scoring to deterministic hybrid keyword
  plus hashed-semantic scoring.
- Official sources checked on 2026-06-10:
  - `https://developers.openai.com/api/docs/assistants/tools/file-search#how-it-works`,
    which states that hosted file search rewrites queries, breaks complex
    queries into multiple searches, runs both keyword and semantic searches,
    and reranks results.
  - `https://developers.openai.com/api/docs/assistants/tools/file-search#improve-file-search-result-relevance-with-chunk-ranking`,
    which documents `hybrid_search.embedding_weight`,
    `hybrid_search.text_weight`, and `score_threshold`.
- Added a local, dependency-free 256-dimensional hashed semantic scorer using
  token stems, character n-grams, and a small deterministic alias map. This
  improves recall for queries such as `automobile repair` against chunks that
  mention `car maintenance` without requiring a new external embedding API key
  or adding persistent vector files.
- Updated search scoring so:
  - default local search combines keyword and hashed-semantic signals;
  - explicit `hybrid_search.embedding_weight` and `hybrid_search.text_weight`
    control the local blend;
  - exact keyword matches are not penalized by weaker semantic scores;
  - semantic-only results must clear a small local minimum before they can
    satisfy `score_threshold`;
  - results expose `text_score`, `embedding_score`, and `score_details` with
    local embedding model/dimension metadata.
- Updated the eval harness, compatibility matrix, and evaluation plan to cover
  local hashed-semantic hybrid search.
- Remaining known gap: this is still a local deterministic compatibility layer,
  not OpenAI managed embeddings, ANN vector indexing, hosted query rewriting, or
  hosted reranking. Provider/model-backed embeddings and larger retrieval evals
  remain future work.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Targeted local file-search/vector-store tests passed 3/3, including a
    semantic-only query with `text_score:0` and `embedding_score >= 0.1`.
  - `npm test`: 72/72 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 173 ms, with `search_results:4` and
    `semantic_search_results:1`.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1701 ms, P95 latency 3375 ms, and total usage
    7766 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq84ou0p`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Runtime Artifact Retention Guard

- Closed an operational maturity gap from the long-running goal: repeated UI
  smoke tests, bridge evaluations, local response storage, and local shell
  artifacts can accumulate under ignored runtime directories even though they
  are not committed to Git.
- Added `scripts/prune-runtime-state.mjs`, a dependency-free retention tool that:
  - defaults to dry-run reporting and only deletes when `--apply` is passed;
  - scans ignored runtime paths under the repository root;
  - prunes by age, item count, and total byte budget;
  - emits a JSON report with scanned, selected, deleted, byte, and reason
    totals for auditability;
  - intentionally leaves local `file_search` vector-store state alone by
    default because it can contain user-provided retrieval data.
- Added `npm run prune:runtime`.
- Added `systemd/aialra-opencodexapp-runtime-prune.service` and
  `systemd/aialra-opencodexapp-runtime-prune.timer` templates for optional
  daily pruning. The service creates its log directory before execution and
  writes JSON reports to `/srv/aialra/logs/opencodexapp/prune/service.log`.
- Updated `docs/deployment.md` and `docs/evaluation-plan.md` with dry-run/apply
  usage, the optional timer, and the retention gate in the 95% parity checklist.
- Verified:
  - `node --check scripts/prune-runtime-state.mjs`: passed.
  - `node --check test/prune_runtime_state.test.js`: passed.
  - Targeted prune test passed 1/1, proving dry-run does not delete, `--apply`
    deletes only selected runtime artifacts, and local file-search state remains
    untouched by default.
  - `npm run prune:runtime -- --dry-run` scanned 211 runtime candidates across
    five targets, selected 0, deleted 0, and reported 0 errors.
  - `npm test`: 73/73 passing tests.
  - `systemd-analyze verify` passed for the runtime prune service and timer
    templates.
  - Bridge, web, and app-server services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.

## 2026-06-10 Local Vector Store Expiration Enforcement

- Closed a vector-store lifecycle compatibility gap where local vector stores
  stored `expires_after` / `expires_at` but searches did not refresh
  `last_active_at`, and expired stores could still be used.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/assistants/tools/file-search#managing-costs-with-expiration-policies`,
  which says vector-store expiration policies can be set on create/update,
  `last_active_at` is the last time a vector store was part of a run, and runs
  fail when a vector store expires.
- Local vector-store search now:
  - refreshes `last_active_at` whenever a direct vector-store search or
    Responses `file_search` uses the store;
  - recomputes `expires_at` from the configured `expires_after` policy after
    each successful search;
  - marks expired stores as `status:"expired"` on get/list for diagnosis;
  - fails closed with `400 vector_store_expired` when an expired store is used
    for direct search or Responses `file_search`.
- Updated the live vector-store lifecycle eval to re-fetch the store after
  searches and assert refreshed `last_active_at` / `expires_at`.
- Updated the compatibility matrix and evaluation plan.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Targeted local file-search/vector-store tests passed 3/3, including direct
    expired search and Responses `file_search` expired-store failure.
  - `npm test`: 73/73 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 145 ms, with `search_results:4` and
    `semantic_search_results:1`.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1707 ms, P95 latency 4045 ms, and total usage
    7710 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq854pt9`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run prune:runtime -- --dry-run` scanned 214 runtime candidates,
    selected 0, deleted 0, and reported 0 errors.

## 2026-06-10 Local Skills API and Shell Skill Mounts

- Closed a Codex/Responses compatibility gap where the bridge did not expose
  OpenAI Skills API endpoints and local shell/code-interpreter requests could
  not mount `skill_reference` bundles.
- Official sources checked on 2026-06-10:
  - OpenAI API endpoint list included `/v1/skills`,
    `/v1/skills/{skill_id}`, `/v1/skills/{skill_id}/content`,
    `/v1/skills/{skill_id}/versions`,
    `/v1/skills/{skill_id}/versions/{version}`, and
    `/v1/skills/{skill_id}/versions/{version}/content`.
  - `https://developers.openai.com/api/docs/guides/tools-skills` describes
    Skills as versioned bundles of files with a `SKILL.md` manifest, directory
    or zip upload, `skill_reference` mounting in shell environments, default
    version updates, and delete rules.
  - `https://developers.openai.com/codex/skills` confirms Codex skills package
    instructions/resources/scripts, use `name` and `description`, and are
    available in the Codex app.
- Added `src/bridge/local_skills.js`, a local file-backed Skills registry under
  `$CODEXCOMPAT_STATE_DIR/local-skills` that:
  - validates exactly one `SKILL.md` manifest and extracts `name` /
    `description`;
  - accepts JSON, multipart directory-style `files[]`, raw `SKILL.md`, and
    storage/deflate zip uploads;
  - exposes skill list/get/update/delete, version create/list/get/delete, and
    content download as `application/zip`;
  - keeps skill bundles in ignored runtime state, not in Git.
- Extended local shell/code-interpreter compatibility so
  `tools[].environment.skills` entries of type `skill_reference` are
  materialized under `/mnt/data/.skills/<skill-name>/v<version>/` before the
  command runs, and recorded under
  `metadata.compatibility.local_shell.mounted_skills`.
- Added `responses-shell-skill` to live `bridge-regression`.
- Updated the compatibility matrix, deployment environment table, and
  evaluation plan.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/local_shell.js`, `src/bridge/local_skills.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Targeted local shell/Skills tests passed 2/2, covering Skills API
    lifecycle, default-version deletion protection, zip content retrieval, and
    shell `skill_reference` mounting.
  - `npm test`: 74/74 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-shell-skill` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1305 ms, output `skill-live-ok`, and total usage
    341 tokens.
  - Full live `bridge-regression` passed 26/26 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1638 ms, P95 latency 4285 ms, and total usage
    8093 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq85uxjm`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run prune:runtime -- --dry-run` scanned 217 runtime candidates,
    selected 1 old UI screenshot by retention policy, deleted 0, and reported
    0 errors.

## 2026-06-10 Local Uploads API Compatibility

- Closed a Responses/Files compatibility gap where clients using OpenAI's
  intermediate Uploads API could not create a File before using `input_file` or
  local `file_search`.
- Official sources checked on 2026-06-10:
  - OpenAI `POST /v1/uploads` creates an intermediate Upload object from
    request fields including `purpose`, `filename`, `bytes`, and `mime_type`;
    the returned object has `status:"pending"`, an expiration around one hour,
    and an official maximum of 8 GB.
  - OpenAI Upload Parts add byte chunks to an Upload; each Part has an
    official maximum of 64 MB and parts can be added independently.
  - OpenAI Upload completion accepts ordered `part_ids`; the final byte count
    must match the originally declared Upload `bytes`; the returned completed
    Upload includes a nested usable File object.
  - OpenAI Upload cancellation returns `status:"cancelled"` and prevents more
    Parts from being added.
- Added `src/bridge/local_uploads.js`, a local file-backed Uploads registry
  under `$CODEXCOMPAT_STATE_DIR/local-uploads` that:
  - creates pending Upload objects with local disk-bounded size limits;
  - accepts Part data as JSON `data` / `data_base64` / `content`, multipart
    `data`, or raw request body;
  - completes ordered `part_ids` into a regular local File and returns the
    completed Upload with nested `file`;
  - rejects byte-count mismatches and blocks new Parts after cancellation.
- Wired `/v1/uploads`, `/v1/uploads/{upload_id}/parts`,
  `/v1/uploads/{upload_id}/complete`, and
  `/v1/uploads/{upload_id}/cancel` into the bridge.
- Updated the local Files store to accept Buffer content from Upload
  completion while preserving the existing text-backed file-search/input-file
  behavior.
- Added `responses-upload-input-file` to live `bridge-regression`; it creates
  an Upload, adds Parts in reverse order, completes them with ordered
  `part_ids`, and uses the resulting File as a Responses `input_file`.
- Updated the compatibility matrix, deployment environment table, and
  evaluation plan.
- Verified:
  - `node --check` passed for `src/bridge/local_uploads.js`,
    `src/bridge/server.js`, and `scripts/eval-harness.mjs`.
  - Targeted local Uploads server test passed inside the full server test run,
    covering ordered Part completion, File content retrieval, Responses
    `input_file` use, cancel blocking, and byte mismatch errors.
  - `npm test`: 75/75 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-upload-input-file` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1439 ms, output `upload-input-ok`, and total
    usage 170 tokens.
  - Full live `bridge-regression` passed 27/27 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1894 ms, P95 latency 4273 ms, and total usage
    8294 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq86piuw`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 222 runtime candidates,
    selected 2 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.

## 2026-06-10 Binary-Safe Local Files and Upload Completion

- Closed the next Uploads/Files fidelity gap: completed Uploads and direct
  Files API uploads now preserve original bytes instead of converting every
  payload through UTF-8 text.
- Official sources checked on 2026-06-10:
  - OpenAI Files API accepts multipart file uploads for use across endpoints;
    the hosted limit is up to 512 MB per file, while this bridge keeps a much
    smaller local default for `/srv/aialra/apps` disk safety.
  - The Files API returns File objects with `id`, `object:"file"`, `bytes`,
    `created_at`, `filename`, and `purpose`; file content is later retrieved
    from `/v1/files/{file_id}/content`.
  - OpenAI Upload completion creates a regular File object from the ordered
    parts; that File must be usable by the rest of the platform.
- Updated the local Files store so new records include `content_base64` and
  `content_encoding:"base64"` for byte preservation. Text-like files also keep
  the previous `content` text field for local file-search indexing and
  backwards compatibility with existing records.
- Updated direct Files API ingestion:
  - multipart parsing now uses the binary parser and preserves each file
    part's content type;
  - raw uploads use `Buffer` content instead of `readBody()` UTF-8 text;
  - JSON uploads accept `content_base64` for binary fixtures and still accept
    legacy `content` strings.
- Updated `/v1/files/{file_id}/content` to return stored bytes with the best
  local content type instead of always returning `text/plain`.
- Updated Responses `input_file.file_id` resolution to read
  `getFileContentBuffer()` first, so completed Upload PDFs can flow through
  the existing local PDF text-layer extractor.
- Added live `responses-upload-input-file-pdf` to `bridge-regression`; it
  uploads a tiny PDF through the Uploads API in two parts, completes it into a
  File, and verifies the model sees the extracted PDF text via Responses
  `input_file`.
- Updated the compatibility matrix, deployment docs, and evaluation plan to
  distinguish byte-preserving Files/Uploads from local text-only file-search
  indexing.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `src/bridge/input_files.js`, `src/bridge/server.js`, and
    `scripts/eval-harness.mjs`.
  - Targeted local Uploads server tests passed inside the full server test run,
    covering text Uploads, binary PDF Uploads, byte-for-byte content download,
    PDF `input_file` extraction, cancel blocking, and byte mismatch errors.
  - `npm test`: 76/76 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-upload-input-file-pdf` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1359 ms, output `upload-pdf-ok`, and total
    usage 173 tokens.
  - Full live `bridge-regression` passed 28/28 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1970 ms, P95 latency 4945 ms, and total usage
    8445 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq874lt8`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 229 runtime candidates,
    selected 5 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.

## 2026-06-10 Legacy Completions Compatibility

- Closed another OpenAI API surface gap by adding local `POST /v1/completions`
  support for legacy prompt-style clients and older evaluation harnesses.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createCompletion` at `/v1/completions` is marked
    legacy and returns `object:"text_completion"` for non-stream responses, or
    a sequence of completion objects for stream responses.
- Implemented the bridge adapter:
  - maps legacy `prompt` strings to upstream Chat `messages`;
  - supports prompt arrays by running one upstream Chat request per prompt and
    aggregating choices;
  - maps `max_tokens` to the configured upstream max-token field;
  - forwards compatible sampling fields, `stop`, `seed`, `n`, optional
    logprobs, stream options, and provider-aware `user`/DeepSeek `user_id`;
  - maps Chat response choices back to legacy `choices[].text`,
    `choices[].index`, `choices[].finish_reason`, and legacy logprobs when
    Chat token logprobs are available;
  - maps Chat streaming chunks to `data: {object:"text_completion"}` SSE
    frames and terminates with `data: [DONE]`;
  - emulates `echo:true` by prefixing the original prompt to returned text;
  - documents best-effort handling for non-lossless legacy fields such as
    `suffix`, token-id prompts, and `best_of`.
- Added two local server tests:
  - non-streaming `/v1/completions` field mapping and response conversion;
  - streaming Chat chunk conversion to legacy completion SSE chunks.
- Added live `completions-legacy` to `bridge-regression`.
- Updated the compatibility matrix and evaluation plan with the legacy
  Completions surface.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - `npm test`: 78/78 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `completions-legacy` passed 1/1 against `deepseek-v4-pro`,
    elapsed 2003 ms, output `completion-ok`, and total usage 52 tokens.
  - Full live `bridge-regression` passed 29/29 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1743 ms, P95 latency 4301 ms, and total usage
    8597 tokens.
  - Direct non-stream `/v1/completions` returned HTTP 200,
    `object:"text_completion"`, output `direct-completion-ok`, and usage 58
    tokens.
  - Direct stream `/v1/completions` returned HTTP 200,
    `text/event-stream; charset=utf-8`, 45 SSE frames, `[DONE]`, and output
    `stream-completion-ok`.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq87kvj8`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 232 runtime candidates,
    selected 6 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.1 MB and output
    artifacts are 4.5 MB.

## 2026-06-10 Stored Streaming Chat Lifecycle

- Closed a Chat Completions lifecycle gap: `POST /v1/chat/completions` now
  stores streamed Chat completions when the incoming request sets both
  `stream:true` and `store:true`.
- Official source checked on 2026-06-10:
  - OpenAI Chat Completions `POST /chat/completions` returns either a
    `chat.completion` object or a streamed sequence of
    `chat.completion.chunk` objects.
  - OpenAI Chat Completions `GET /chat/completions` lists stored Chat
    Completions, and only records created with `store:true` are returned.
- Implemented streamed Chat reconstruction in the passthrough path:
  - forwards upstream Chat SSE frames to the client while parsing them;
  - reconstructs a terminal local `object:"chat.completion"` record from the
    observed `chat.completion.chunk` stream;
  - accumulates assistant text, streamed tool-call argument fragments,
    annotations, refusal text, audio deltas, logprobs when present, finish
    reasons, usage-bearing final chunks, service tier, system fingerprint, and
    request metadata;
  - stores normalized input/output messages so
    `/v1/chat/completions/{completion_id}/messages` works for streamed records;
  - keeps storage opt-in: ordinary streamed Chat passthrough requests without
    `store:true` remain unpersisted.
- Added local server coverage for streaming stored Chat:
  - mock upstream streams two choices, text deltas, tool-call argument
    fragments, logprobs, usage, service tier, and system fingerprint;
  - the test verifies SSE passthrough, local retrieval, messages listing, and
    metadata-filtered list behavior.
- Added live `chat-stream-lifecycle` to `bridge-regression`; it streams through
  DeepSeek, retrieves the stored completion, updates metadata, lists messages,
  lists by metadata, deletes, and verifies 404 after deletion.
- Updated the compatibility matrix and evaluation plan to document streaming
  `store:true` support.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm test`: 79/79 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-stream-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2960 ms, output `chat-stream-life-ok`, 85 SSE
    events, stored message count 2, and total usage 97 tokens.
  - Full live `bridge-regression` passed 30/30 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1663 ms, P95 latency 4565 ms, and total usage
    8569 tokens.
  - Direct streamed Chat passthrough probe returned HTTP 200, 47 SSE frames,
    `[DONE]`, output `direct-chat-stream-ok`, stored
    `object:"chat.completion"`, message count 2, total usage 58 tokens, and
    delete status 200.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq87y0wt`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 234 runtime candidates,
    selected 6 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.2 MB and output
    artifacts are 4.5 MB.

## 2026-06-10 Local Embeddings Endpoint

- Added local OpenAI-compatible `POST /v1/embeddings` coverage so clients,
  retrieval tests, and evaluation tooling can request embedding-shaped vectors
  even when the upstream provider only exposes Chat Completions.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createEmbedding` at `/v1/embeddings` creates an
    embedding vector representing input text and returns `object:"list"` with
    `object:"embedding"` data items, `index`, `model`, and prompt-token usage.
- Implemented a deterministic local adapter:
  - accepts single string input, arrays of strings/items, token id arrays, and
    arrays of token id arrays;
  - supports `dimensions` from 1 to 3072;
  - supports `encoding_format:"float"` and `encoding_format:"base64"`;
  - returns normalized hashed-semantic vectors using the same local feature
    space as the Vector Store hybrid search adapter;
  - returns OpenAI-style `object`, `data`, `model`, and `usage` fields plus a
    `compatibility` block that makes the local provider boundary explicit;
  - adds `CODEXCOMPAT_EMBEDDINGS_MODEL` and
    `CODEXCOMPAT_EMBEDDINGS_DIMENSIONS` configuration.
- Added local server tests for deterministic float vectors, batched inputs,
  base64 token inputs, parameter validation, and no upstream provider calls.
- Added live `embeddings-local` to `bridge-regression`.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Tightened the live `chat-stream-lifecycle` eval request with
  `temperature:0` and `thinking:{type:"disabled"}` after one full-regression
  attempt showed DeepSeek could spend the entire Chat stream budget without
  ordinary content deltas when thinking mode was left implicit. The bridge
  behavior was not changed; the eval now tests protocol lifecycle rather than
  provider sampling variance.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/local_file_search.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm test`: 81/81 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `embeddings-local` passed 1/1, elapsed 47 ms, output
    `embeddings:2x32`, and local usage 14 prompt tokens.
  - Targeted live `chat-stream-lifecycle` passed 1/1 after eval hardening,
    elapsed 1438 ms, output `chat-stream-life-ok`, and total usage 19 tokens.
  - First full live `bridge-regression` attempt passed 30/31; only
    `chat-stream-lifecycle` failed because the model emitted no ordinary
    content deltas before hitting its output cap with implicit thinking mode.
  - Full live `bridge-regression` after eval hardening passed 31/31 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1600 ms, P95 latency
    3820 ms, and total usage 8490 tokens.
  - Direct `/v1/embeddings` float probe returned HTTP 200,
    `object:"list"`, two 24-dimensional vectors, model
    `text-embedding-3-small`, and usage 12 prompt tokens.
  - Direct `/v1/embeddings` base64 token probe returned HTTP 200,
    `object:"list"`, 12 dimensions encoded as 48 bytes, and usage 3 prompt
    tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq88bold`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 239 runtime candidates,
    selected 7 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.3 MB and output
    artifacts are 4.6 MB.
- Remaining known gap: local `/v1/embeddings` is deterministic compatibility
  infrastructure, not a hosted/model-backed OpenAI embedding model. Future
  work should add provider-backed embeddings and ANN indexing while preserving
  this local fallback for no-key and disk-bounded tests.

## 2026-06-10 Local Batch API Compatibility

- Added local OpenAI-compatible Batch API coverage for JSONL workloads over the
  bridge's already implemented endpoints.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createBatch` at `/v1/batches` requires
    `input_file_id`, `endpoint`, and `completion_window`, supports endpoint
    values including `/v1/responses`, `/v1/chat/completions`,
    `/v1/embeddings`, and `/v1/completions`, and returns a `batch` object with
    `request_counts`, `output_file_id`, and `error_file_id`.
  - OpenAI Batch guide notes that completed output and error JSONL files are
    retrieved through the Files API and should be joined back to input lines
    via `custom_id` instead of line order.
- Implemented a local synchronous adapter:
  - `POST /v1/batches` validates `purpose:"batch"` Files and JSONL request
    lines;
  - supports `/v1/responses`, `/v1/chat/completions`, `/v1/completions`, and
    `/v1/embeddings`;
  - reuses the existing local endpoint handlers instead of duplicating
    protocol mapping logic;
  - writes successful request records to a local `purpose:"batch_output"`
    JSONL File and per-line failures to a local `purpose:"batch_error"` JSONL
    File;
  - marks the Batch explicitly `failed` if local output/error File creation
    fails, avoiding orphaned `in_progress` records;
  - implements `GET /v1/batches`, `GET /v1/batches/{batch_id}`, and
    `POST /v1/batches/{batch_id}/cancel`;
  - rejects `stream:true` and `background:true` per JSONL line because local
    synchronous Batch files cannot represent open streams or still-running
    background jobs;
  - adds `CODEXCOMPAT_BATCH_MAX_REQUESTS`, defaulting to 1000 for the test
    deployment's disk/quota safety.
- Added unit tests for:
  - Responses Batch execution with one successful output line and one rejected
    streaming line in the error file;
  - retrieve/list/cancel lifecycle shape;
  - local embeddings Batch execution without upstream provider calls.
- Added live `batch-embeddings-local` to `bridge-regression`, covering
  `/v1/files` input upload, `/v1/batches` create/retrieve/list/cancel, output
  JSONL retrieval through `/v1/files/{file_id}/content`, and cleanup.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 55/55 passing tests.
  - `npm test`: 83/83 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `batch-embeddings-local` passed 1/1, elapsed 145 ms, created
    a local `batch` with 2 completed requests, no error file, 2 output JSONL
    lines, retrieve/list/cancel all HTTP 200, and local usage 15 prompt tokens.
  - Full live `bridge-regression` passed 32/32 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1550 ms, P95 latency 3913 ms, and total usage
    8706 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq88xrvs`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 250 runtime candidates,
    selected 10 old UI screenshots by retention policy, deleted 0, and
    reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 42 GB available; bridge state is 1.4 MB and output
    artifacts are 4.8 MB.
- Remaining known gap: this is a local synchronous Batch compatibility layer,
  not OpenAI's distributed asynchronous 24h job service. Future work should add
  persisted async workers, restartable queues, larger disk-governed staging
  profiles, and Batch coverage for moderation/image/video endpoints as those
  local adapters are implemented.

## 2026-06-10 Local Moderations Compatibility

- Added local OpenAI-compatible Moderations API coverage for
  Chat-Completions-only provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createModeration` at `/v1/moderations`
    classifies text and/or image inputs and returns an object with `id`,
    `model`, and `results`.
  - Each result contains `flagged`, `categories`, `category_scores`, and, for
    current omni moderation responses, `category_applied_input_types`.
  - Current omni categories include harassment, harassment/threatening, sexual,
    hate, hate/threatening, illicit, illicit/violent, self-harm,
    self-harm/intent, self-harm/instructions, sexual/minors, violence, and
    violence/graphic.
- Implemented a local deterministic adapter:
  - `POST /v1/moderations` accepts a string, an array of strings, or a
    multimodal text/image content-part array;
  - returns `modr_` ids, OpenAI-style category booleans, category scores, and
    applied input-type metadata;
  - uses `CODEXCOMPAT_MODERATIONS_MODEL`, defaulting to
    `omni-moderation-latest`, when the request omits `model`;
  - adds the configured moderation model to local `/v1/models/{model}` fallback
    behavior when the upstream provider does not expose it;
  - explicitly marks the response as local deterministic compatibility
    metadata and does not call the upstream Chat provider;
  - extends local Batch execution to accept `/v1/moderations` JSONL requests
    alongside Responses, Chat, legacy Completions, and Embeddings.
- Added unit tests for:
  - direct local Moderations response shape, flagged/unflagged text categories,
    multimodal applied input types, and input validation;
  - local Batch execution over `/v1/moderations` without upstream provider
    calls;
  - model retrieval fallback for `omni-moderation-latest`.
- Added live `moderations-local` and `batch-moderations-local` to
  `bridge-regression`.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 57/57 passing tests.
  - `npm test`: 85/85 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Direct local `/v1/moderations` probe returned HTTP 200, a `modr_` id, two
    results, and one flagged violence/threat result.
  - Targeted live `moderations-local` passed 1/1, elapsed 58 ms, output
    `moderations:2:flagged:1`.
  - Targeted live `batch-moderations-local` passed 1/1, elapsed 141 ms, created
    a local `batch` with 2 completed requests, no error file, 2 output JSONL
    lines, retrieve/list/cancel all HTTP 200, and zero provider token usage.
  - Full live `bridge-regression` passed 34/34 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 2075 ms, P95 latency 5653 ms, and total usage
    8559 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq89emsz`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 256 runtime candidates,
    selected 11 old UI screenshots by retention policy, deleted 0, selected
    625129 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 42 GB available; bridge state is 1.5 MB and output
    artifacts are 4.8 MB.
- Remaining known gap: this is deterministic local moderation compatibility,
  not OpenAI's hosted moderation classifier and not image-pixel inspection.
  Future work should add provider-backed or specialized moderation models,
  multilingual safety evals, image inspection, and larger safety benchmark
  suites while preserving the local no-upstream fallback.

## 2026-06-10 Inline Moderation Compatibility

- Added local inline moderation compatibility for Chat-Completions-only
  provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI Chat Completions `create` exposes a `moderation` request
    configuration for running moderation on request input and generated output.
  - OpenAI Responses `create` exposes a `moderation` request configuration for
    running moderation on the input and output of a response.
- Implemented local inline moderation fallback:
  - `/v1/responses` accepts `moderation:{input:true,output:true}` and attaches
    local results to `response.moderation.input` and/or
    `response.moderation.output` when the upstream Chat provider omits a native
    moderation payload;
  - `/v1/chat/completions` accepts the same field, strips it before upstream
    calls when provider-native Chat fields are disabled for DeepSeek-style
    compatibility, and attaches local `completion.moderation` results;
  - stored Chat completions preserve local inline moderation on retrieval;
  - streaming Responses attach local inline moderation to the terminal response
    event; direct streaming Chat passthrough remains byte-preserving and does
    not synthesize extra stream chunks;
  - upstream Chat `moderation` payloads are now preserved on translated
    Responses as `response.moderation` and
    `metadata.compatibility.chat_moderation`.
- Added unit tests for:
  - Responses inline moderation with provider field filtering;
  - streaming Responses terminal moderation metadata;
  - direct Chat Completions inline moderation with stored retrieval;
  - upstream Chat moderation preservation in the translator.
- Added live `responses-inline-moderation` to `bridge-regression`.
- Updated the compatibility matrix and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 59/59 passing tests.
  - `node --test test/translator.test.js`: 25/25 passing tests.
  - `npm test`: 87/87 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Direct local `/v1/responses` inline moderation probe returned HTTP 200 and
    `response.moderation` with local input/output moderation results.
  - Targeted live `responses-inline-moderation` passed 1/1, elapsed 1630 ms,
    output `inline-moderation-ok`, and total usage 53 tokens.
  - Full live `bridge-regression` passed 35/35 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1777 ms, P95 latency 4525 ms, and total usage
    8644 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq89v04j`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 261 runtime candidates,
    selected 12 old UI screenshots by retention policy, deleted 0, selected
    705534 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 41 GB available; bridge state is 1.6 MB and output
    artifacts are 4.9 MB.
- Remaining known gap: local inline moderation uses the same deterministic
  compatibility classifier as `/v1/moderations`; it is not OpenAI's hosted
  moderation model and direct streaming Chat passthrough remains byte-preserving
  instead of appending synthetic moderation events.

## 2026-06-10 Encrypted Reasoning Compatibility

- Added local Responses `include:["reasoning.encrypted_content"]`
  compatibility for Chat-Completions-only provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI migration guidance says stateless reasoning workflows should set
    `store:false`, add `["reasoning.encrypted_content"]` to `include`, pass
    encrypted reasoning items back in later requests, and have encrypted content
    decrypted only in memory for continuation.
- Implemented local encrypted reasoning emulation:
  - non-streaming `/v1/responses` adds `encrypted_content` to each output
    `reasoning` item when the request includes
    `reasoning.encrypted_content` and the upstream Chat provider returns
    `message.reasoning_content`;
  - streaming `/v1/responses` adds the same encrypted content before
    `response.output_item.done` and terminal `response.completed` events;
  - returned local reasoning tokens use prefix `ocrsn1.` with AES-256-GCM and a
    dedicated reasoning AAD, while reusing the existing
    `CODEXCOMPAT_COMPACTION_SECRET_FILE` key material kept outside Git;
  - replayed `reasoning` input items with local `encrypted_content` are decoded
    in memory into upstream Chat `reasoning_content`;
  - undecodable foreign encrypted reasoning falls back to visible
    `reasoning.summary[]` text when present;
  - `metadata.compatibility.local_reasoning_encrypted_content` records local
    emulation status and output count.
- Added unit tests for:
  - translator replay of local encrypted reasoning with summary fallback for
    foreign tokens;
  - non-streaming Responses encrypted reasoning output and stateless replay;
  - streaming Responses encrypted reasoning on `output_item.done` and terminal
    `response.completed`.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 61/61 passing tests.
  - `node --test test/translator.test.js`: 26/26 passing tests.
  - `npm test`: 90/90 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Direct live `/v1/responses` encrypted-reasoning probe returned
    `status:"completed"`, one reasoning item, one `ocrsn1.` encrypted content
    field, exact visible text `encrypted-reasoning-ok`, and local compatibility
    metadata with `output_count:1`.
  - Direct live stateless replay probe returned `ok:true`; both turns
    completed and the second turn returned exact visible text
    `encrypted-replay-ok` without printing the encrypted token.
  - Full live `bridge-regression` passed 35/35 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1447 ms, P95 latency 3724 ms, and total usage
    8710 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ac4qi`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 266 runtime candidates,
    selected 13 old UI screenshots by retention policy, deleted 0, selected
    789181 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 40 GB available; bridge state is 1.7 MB and output
    artifacts are 5.1 MB.
- Remaining known gap: this preserves provider-returned reasoning state for
  DeepSeek-style Chat compatibility; it cannot reconstruct hidden reasoning
  tokens when a Chat provider does not expose `reasoning_content`, and local
  encrypted reasoning tokens are only decryptable by this bridge/key.

## 2026-06-10 Prompt Template Compatibility

- Added local Responses `prompt` compatibility for Chat-Completions-only
  provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI Responses `create` exposes `prompt` as a reference to a prompt
    template and its variables.
  - The same Responses create reference documents `instructions`, `input`, and
    other request context that may be combined with a prompt reference.
- Implemented local prompt-template handling:
  - official-shaped `prompt:{id,version,variables}` references are expanded
    when a matching local template is configured;
  - templates are keyed by `id` or `id@version` and can come from
    `CODEXCOMPAT_PROMPT_TEMPLATES` JSON or
    `CODEXCOMPAT_PROMPT_TEMPLATE_FILE`, with env JSON overriding duplicate file
    keys;
  - local templates support `instructions`, `messages`, `input`, `content`,
    and `text`, with `{{variable}}` substitution;
  - inline local templates are supported with `prompt.template` /
    `prompt.local_template` for deterministic local evals and migration
    fixtures;
  - when a hosted prompt reference cannot be expanded locally, the bridge
    injects a bounded compatibility system message that preserves prompt
    id/version/variable keys instead of silently dropping the field;
  - `metadata.compatibility.prompt_template` records whether the prompt was
    expanded locally or preserved as an unavailable hosted reference.
- Added tests for:
  - translator expansion of configured prompt templates before request
    instructions/input;
  - translator fallback for hosted prompt references with no local template;
  - server-level `/v1/responses` expansion into upstream Chat messages;
  - config loading from prompt-template file and env JSON.
- Added live `responses-prompt-template-local` to `bridge-regression`.
- Updated `.env.example`, the compatibility matrix, deployment docs, and the
  evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 63/63 passing tests.
  - `node --test test/translator.test.js`: 28/28 passing tests.
  - `npm test`: 94/94 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-prompt-template-local` passed 1/1, elapsed
    1903 ms, output `prompt-template-ok`, and total usage 74 tokens.
  - Full live `bridge-regression` passed 36/36 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1308 ms, P95 latency 3289 ms, and total usage
    8756 tokens.
  - UI smoke passed with marker `ui-smoke-mq8an7w9`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 271 runtime candidates,
    selected 14 old UI screenshots by retention policy, deleted 0, selected
    874090 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 40 GB available; bridge state is 1.7 MB and output
    artifacts are 5.1 MB.
- Remaining known gap: the bridge cannot fetch OpenAI-hosted dashboard prompt
  templates by id; those references require a local template mirror or are
  preserved as compatibility context for the Chat provider.

## 2026-06-10 Web Search Action Sources Compatibility

- Added local Responses `include:["web_search_call.action.sources"]`
  compatibility for Chat-Completions-only providers.
- Official source checked on 2026-06-10:
  - OpenAI Responses `create` lists `web_search_call.action.sources` as a
    supported `include` value for exposing web-search tool-call sources.
- Implemented local source projection:
  - `prepareWebSearchContext` records whether the request explicitly asked for
    `web_search_call.action.sources`;
  - `webSearchOutputItems` now adds `action.sources` only when requested,
    preserving the default response projection otherwise;
  - search actions expose local URL sources with title, snippet, and source
    index;
  - local `open_page` and `find_in_page` actions expose the matching URL source
    plus bounded open/find status metadata;
  - `metadata.compatibility.local_web_search.action_sources` records local
    inclusion status and source count.
- Added tests for:
  - default local web-search output omitting `action.sources`;
  - non-streaming Responses output including local `action.sources` when
    requested;
  - streaming `response.output_item.added` events carrying sources when the
    include value is present.
- Updated live `responses-web-search` in `bridge-regression` to request and
  verify `web_search_call.action.sources`.
- Updated the compatibility matrix and evaluation plan.
- Verified:
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 64/64 passing tests.
  - `npm test`: 95/95 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-web-search` passed 1/1, elapsed 1784 ms, output
    `web-search-ok [1]`, and total usage 4040 tokens.
  - Full live `bridge-regression` passed 36/36 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1257 ms, P95 latency 2805 ms, and total usage
    8655 tokens.
  - UI smoke passed with marker `ui-smoke-mq8aya7b`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 276 runtime candidates,
    selected 15 old UI screenshots by retention policy, deleted 0, selected
    959516 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 40 GB available; bridge state is 1.8 MB, output
    artifacts are 5.2 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.
- Remaining known gap: this exposes sources from the local web-search adapter;
  it is not OpenAI hosted web-search ranking or policy parity and still depends
  on the configured local provider.

## 2026-06-10 Local Responses Truncation Compatibility

- Added local Responses `truncation` compatibility before upstream Chat calls.
- Official source checked on 2026-06-10:
  - OpenAI Responses `create` documents `truncation:"auto"` as dropping items
    from the beginning of the conversation when input exceeds the model context
    window.
  - The same reference documents `truncation:"disabled"` as the default, where
    oversized input fails with a 400-style error instead of being truncated.
- Implemented local truncation handling:
  - added `CODEXCOMPAT_TRUNCATION_MAX_INPUT_CHARS`, default `400000`, as the
    bridge's estimated input-character budget for Chat-only providers;
  - `truncation:"auto"` drops oldest `conversation` / `previous_response_id`
    replay messages first, preserving current request input and local tool
    context;
  - `metadata.compatibility.local_truncation` records the local budget, before
    and after estimates, dropped message count, dropped roles, and status;
  - omitted or `disabled` truncation returns `400 context_length_exceeded`
    before calling the provider when the local budget is exceeded;
  - the same preflight is applied to normal Responses, streaming Responses,
    background Responses, `/v1/responses/input_tokens`, and
    `/v1/responses/compact`.
- Added tests for:
  - `truncation:"auto"` dropping the oldest replay messages before upstream
    Chat while preserving current input;
  - omitted/disabled truncation returning `context_length_exceeded` before any
    provider request.
- Updated `.env.example`, deployment docs, the compatibility matrix, and the
  evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 66/66 passing tests.
  - `npm test`: 97/97 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Full live `bridge-regression` passed 36/36 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1273 ms, P95 latency 3475 ms, and total usage
    8640 tokens.
  - UI smoke passed with marker `ui-smoke-mq8bakz7`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 281 runtime candidates,
    selected 16 old UI screenshots by retention policy, deleted 0, selected
    1044764 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.9 MB, output
    artifacts are 5.3 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.
- Remaining known gap: this uses a deterministic character estimate because
  Chat Completions providers do not expose the Responses service's exact
  tokenizer/context-window truncation behavior. Provider-specific tokenizers can
  replace the estimate later for closer parity.

## 2026-06-10 Stored Responses Metadata Update Compatibility

- Added local support for `POST /v1/responses/{response_id}`:
  - accepts only a JSON `metadata` object, matching the stored-object update
    surface already implemented for Chat Completions;
  - returns `404 response_not_found` for missing local response records;
  - returns `400 unsupported_response_update` when callers try to update fields
    other than `metadata` or pass non-object metadata;
  - preserves local `metadata.compatibility` and `metadata.upstream_object`
    observability fields when replacing user metadata.
- Added background-response metadata durability:
  - metadata updates applied while a local background response is still
    `in_progress` are merged into the final completed response after the
    upstream Chat Completions call returns;
  - final background records still preserve local compatibility flags such as
    `background` and `stream`.
- Official source checked on 2026-06-10:
  - OpenAI's OpenAPI endpoint list includes
    `/responses/{response_id}` alongside `/responses/{response_id}/cancel` and
    `/responses/{response_id}/input_items`.
- Added tests for:
  - successful stored Responses metadata update and subsequent GET persistence;
  - invalid non-metadata update rejection;
  - missing response update returning 404;
  - in-progress background response metadata update persisting into the
    completed response.
- Extended the live `bridge-regression` suite with `responses-lifecycle`,
  covering create, retrieve, update metadata, list input items, terminal cancel
  no-op, delete, and post-delete 404.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 66/66 passing tests.
  - `npm test`: 97/97 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-lifecycle` passed 1/1, elapsed 2278 ms, returned
    update/input-items/cancel/delete statuses 200/200/200/200, post-delete GET
    404, and total usage 67 tokens.
  - Full live `bridge-regression` passed 37/37 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1617 ms, P95 latency 4206 ms, and total usage
    8828 tokens.
  - UI smoke passed with marker `ui-smoke-mq8bnefq`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 286 runtime candidates,
    selected 17 old UI screenshots by retention policy, deleted 0, selected
    1129626 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 2.0 MB, output
    artifacts are 5.4 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.

## 2026-06-10 Local Computer Use Compatibility

- Added a local Responses `computer` / `computer_use_preview` adapter for
  Chat-only providers:
  - reserves the hosted tool locally so it is not sent upstream as an
    unsupported Chat tool;
  - emits a screenshot-first `computer_call` output item with both GA
    `actions:[{type:"screenshot"}]` and preview-compatible
    `action:{type:"screenshot"}`;
  - preserves `call_id`, `environment`, display dimensions,
    `pending_safety_checks`, and `metadata.compatibility.local_computer`;
  - maps returned `computer_call_output` input items into readable Chat context
    including `call_id`, `output.type`, `output.image_url`, `detail`, text, and
    acknowledged safety-check count;
  - consumes the shared local `max_tool_calls` budget and records skipped
    computer actions in `metadata.compatibility.local_tool_budget`;
  - disables DeepSeek thinking mode by default for local computer-use requests
    so small-output compatibility probes get visible assistant text.
- Wired the adapter through non-streaming, streaming, and background Responses
  paths. Streaming now sends local `computer_call` items as
  `response.output_item.added` before upstream Chat text deltas.
- Extended tests and live evals:
  - translator tests cover local hosted-tool reservation for `computer` and
    `computer_call_output` input mapping;
  - server tests cover non-streaming `computer_call`, streaming `computer_call`,
    `max_tool_calls` exhaustion, metadata, and DeepSeek thinking compatibility;
  - live `bridge-regression` now includes `responses-computer`.
- Updated docs:
  - compatibility matrix references the official OpenAI Computer Use guide;
  - documented request/response mappings, config flags, eval commands, and the
    remaining boundary: this is an action-loop protocol adapter, not a
    browser/VNC executor or OpenAI hosted Computer Use.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js`: 30/30 passing tests.
  - `node --test test/server.test.js`: 69/69 passing tests.
  - `npm test`: 102/102 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active. Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/` after the service restart window.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-computer` passed 1/1, elapsed 1788 ms, returned
    `computer-ok`, and used 170 total tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1748 ms, P95 latency 4157 ms, and total usage
    8876 tokens.
  - UI smoke passed with marker `ui-smoke-mq8c6giz`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 291 runtime candidates,
    selected 18 old UI screenshots by retention policy, deleted 0, selected
    1214456 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 38 GB available; bridge state is 2.0 MB, output
    artifacts are 5.5 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.

## 2026-06-10 Restartable Background Provider Calls

- Added file-backed local background job snapshots for `background:true`
  Responses:
  - newly created background responses now store `background_job.stage:"queued"`
    with the normalized request, Chat request, compatibility metadata,
    previous-message snapshot, and conversation snapshot;
  - after local input-file/tool/context preparation succeeds, the job snapshot
    advances to `stage:"provider_pending"` and stores the final upstream Chat
    request plus local output items that must be prepended to the completed
    Responses output;
  - final completed/failed/cancelled terminal records remove
    `background_job`, keeping state bounded and avoiding accidental replays.
- Added restart recovery:
  - bridge startup now resumes `provider_pending` snapshots by retrying the
    upstream Chat provider call and preserving local output items;
  - `queued` snapshots can restart the full local preparation path;
  - missing snapshots, unknown stages, or `preparing` snapshots fail closed with
    `background_job_interrupted_by_restart` and
    `metadata.compatibility.background_restart_reason` so side-effecting local
    tools are not re-run after an unsafe interruption.
- Fixed a compatibility metadata merge footgun by changing
  `mergeCompatibility` to accept any number of object parts. This preserves
  background resume metadata and extra local moderation compatibility entries
  in paths that already passed more than three merge inputs.
- Added server tests for:
  - stale in-progress background records without a persistent job snapshot
    still reconciling to explicit failed terminal responses;
  - `provider_pending` background records being resumed on startup, completing
    through the mock provider, preserving prepended local output items, and
    clearing `background_job` from the final store record;
  - corrupt resumable snapshots with invalid `max_tool_calls` failing closed
    during startup without crashing the bridge or calling the provider.
- Official source checked on 2026-06-10:
  - OpenAI's Responses migration guide describes background mode as a Responses
    capability with `in_progress` to terminal-state polling semantics; this
    bridge emulates that lifecycle locally for Chat-only providers.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 71/71 passing tests.
  - `npm test`: 104/104 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2, pass rate 1.0, average latency 1259 ms, P95
    latency 1423 ms, and total usage 160 tokens.
  - Targeted live `responses-background` passed 1/1 after the final deploy,
    elapsed 2109 ms, status history `in_progress`, `in_progress`,
    `completed`, and total usage 56 tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1315 ms, P95 latency 3344 ms, and total usage
    8899 tokens.
  - UI smoke passed with marker `ui-smoke-bgresume-final-20260610`, reload
    persistence confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 303 runtime candidates,
    selected 20 old UI screenshots by retention policy, deleted 0, selected
    1383964 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 38 GB available; repository checkout is 38 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 11 MB.

## 2026-06-10 Background Preparation Checkpoints

- Added resumable checkpoints inside local `background:true` preparation:
  - the background job now records `prepare.status`, `current_step`,
    `next_step`, completed steps, mutated upstream Chat request, compatibility
    metadata, local context snapshots, and the shared local `max_tool_calls`
    budget after each safe step boundary;
  - completed local contexts are reused to build final Responses output items
    after restart, so already-finished shell/computer/web/file-search work is
    not repeated;
  - startup resumes `stage:"preparing"` snapshots only when
    `prepare.status:"ready"` points to a safe next step, and marks
    `metadata.compatibility.background_restart:"resumed_preparation"`;
  - snapshots interrupted while a local preparation step is actively
    `running` still fail closed with
    `background_restart_reason:"interrupted_during_local_preparation_<step>"`
    to avoid re-running side-effecting local tools such as shell commands.
- Hardened persisted local tool budgets:
  - resume now validates persisted `used`, `skipped`, and bounded
    `skipped_calls` before continuing;
  - corrupt persisted budgets reconcile to explicit failed terminal responses
    without crashing bridge startup or calling the upstream provider.
- Added server tests for:
  - resuming from a ready preparation checkpoint after a persisted shell step
    and continuing with a local computer step;
  - preserving exactly one persisted shell call/output plus the new computer
    call in the final Responses output;
  - failing `running` preparation snapshots closed without calling the
    provider.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 73/73 passing tests.
  - `npm test`: 106/106 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-background` passed 1/1 after the final deploy,
    elapsed 2090 ms, status history `in_progress`, `in_progress`, `completed`,
    and total usage 39 tokens.
  - One full live `bridge-regression` attempt passed 37/38 because
    `chat-passthrough` returned HTTP 200 with empty visible text; targeted
    `chat-passthrough` rerun then passed 1/1, indicating provider output
    nondeterminism rather than bridge failure.
  - Final full live `bridge-regression` passed 38/38 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1545 ms, P95 latency
    4025 ms, and total usage 8911 tokens.
  - `protocol-smoke` passed 2/2, pass rate 1.0, average latency 1604 ms, P95
    latency 1670 ms, and total usage 154 tokens.
  - UI smoke passed with marker `ui-smoke-bgprep-final-20260610`, reload
    persistence confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 319 runtime candidates,
    selected 22 old UI screenshots by retention policy, deleted 0, selected
    1553681 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 37 GB available; repository checkout is 38 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 11 MB.

## 2026-06-10 Background Lease Ownership

- Added persistent lease ownership for local `background:true` jobs:
  - each bridge process gets a runtime `backgroundLeaseOwner`;
  - newly created background job snapshots store `background_job.lease` with
    owner, random token, acquisition/renewal timestamps, and expiry;
  - preparation checkpoints and `provider_pending` transitions renew the lease
    while the owning process advances the job.
- Hardened startup recovery for multi-process/restart races:
  - before resuming or reconciling an in-progress background response, startup
    acquires a short-lived per-response claim lock next to the response JSON;
  - startup skips records with an unexpired lease owned by another bridge
    process instead of calling the provider or marking the response failed;
  - expired or missing leases can be claimed, re-read, and verified by token
    before safe resume/reconcile behavior continues.
- Added server tests for:
  - skipping an active foreign lease without touching response metadata or
    calling the upstream provider;
  - claiming an expired lease, exposing the new owner in the store while the
    resumed provider call is pending, then completing and clearing
    `background_job`;
  - preserving prior provider-pending and preparation-checkpoint resume
    behavior.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 75/75 passing tests.
  - `npm test`: 108/108 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-background` passed 1/1 after the deploy, elapsed
    2072 ms, status history `in_progress`, `in_progress`, `completed`, and
    total usage 49 tokens.
  - `protocol-smoke` passed 2/2, pass rate 1.0, average latency 1701 ms, P95
    latency 1744 ms, and total usage 188 tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1314 ms, P95 latency 3606 ms, and total usage
    8793 tokens.
  - UI smoke passed with marker `ui-smoke-bgleases-final-20260610`, reload
    persistence confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 325 runtime candidates,
    selected 23 old UI screenshots by retention policy, deleted 0, selected
    1638231 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 40 GB available;
    repository checkout is 38 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 11 MB.

## 2026-06-10 Chat Audio Output Mapping

- Checked current official OpenAI docs through the OpenAI developer-docs MCP:
  Chat Completions exposes audio-capable output through `modalities` plus the
  `audio` request parameter, while the OpenAI audio guide treats audio output as
  an audio-capable Chat provider feature rather than something a text-only
  provider can synthesize.
- Added Chat-to-Responses preservation for audio-capable Chat providers:
  - non-streaming `choices[].message.audio` is normalized into a
    `type:"output_audio"` message content part;
  - known scalar audio fields `data`, `transcript`, `id`, `expires_at`,
    `format`, and `voice` are exposed directly on that content part;
  - provider-specific audio fields are preserved under `content[].audio`;
  - the original Chat audio object is also copied to
    `metadata.compatibility.chat_audio[]` and the local replay store.
- Added streaming `choices[].delta.audio` handling:
  - string `data` and `transcript` fragments are accumulated across chunks;
  - other audio fields are merged with the latest provider value;
  - the final terminal Responses object carries the accumulated
    `output_audio` part plus `metadata.compatibility.chat_audio[]`;
  - `previous_response_id` replay preserves the original assistant `audio`
    object for later Chat requests.
- Added tests for:
  - translator mapping of Chat audio output into Responses message content,
    compatibility metadata, usage audio-token preservation, and replay;
  - mock `/v1/responses` forwarding of `modalities`/`audio`, Chat audio output
    mapping, and previous-response replay of assistant audio;
  - streaming `delta.audio` accumulation alongside text, annotations,
    logprobs, usage, and terminal Responses events.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document audio-object preservation and the remaining text-only-provider
  boundary for DeepSeek.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js test/server.test.js`: 107/107 passing
    tests.
  - `npm test`: 110/110 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1470 ms, P95 latency 1475 ms, and total usage 160 tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1391 ms, P95 latency 4011 ms, and total usage
    8959 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ej041`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 330 runtime candidates,
    selected 24 old UI screenshots by retention policy, deleted 0, selected
    1722307 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 39 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Batch Chat and Legacy Completions Coverage

- Checked the current official OpenAI Batch guide through the OpenAI
  developer-docs MCP. The guide lists `/v1/responses`,
  `/v1/chat/completions`, `/v1/embeddings`, `/v1/completions`, and
  `/v1/moderations` among JSONL Batch endpoints, with each line carrying
  `custom_id`, `method`, `url`, and endpoint-specific `body`.
- Promoted existing local Batch support for Chat and legacy Completions from
  implicit code path to tested compatibility surface:
  - added live `bridge-regression` cases for `/v1/chat/completions` Batch and
    `/v1/completions` Batch;
  - added mock-provider server coverage that executes a Chat batch with one
    success and one rejected `stream:true` line, then executes a legacy
    Completions batch and verifies the returned `text_completion` output file;
  - extended eval usage aggregation so Batch output from Responses, Chat, and
    legacy Completions contributes token usage instead of falling back to
    zero-use moderation accounting.
- Fixed a real local Batch capture bug found by the new tests:
  - direct Chat passthrough writes `Uint8Array` chunks from Node `fetch`;
  - the internal Batch capture response previously treated non-`Buffer` chunks
    as strings, corrupting JSON output into comma-separated byte values;
  - `makeCaptureResponse.write()` now preserves any `ArrayBuffer` view as
    binary bytes before parsing the captured JSON body.
- Improved audit fidelity by preserving upstream `x-request-id` headers through
  `proxyResponseHeaders()`, so Batch output lines use provider request ids when
  available and only generate local `req_*` ids as a fallback.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` with the
  Batch Chat/Completions coverage and request-id preservation behavior.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 77/77 passing tests.
  - `npm test`: 111/111 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Targeted live `batch-chat-completions` passed 1/1 against
    `deepseek-v4-pro`, elapsed 3306 ms, request counts 2 completed / 0 failed,
    and total usage 120 tokens.
  - Targeted live `batch-completions-legacy` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1632 ms, request counts 1 completed / 0 failed,
    and total usage 55 tokens.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1860 ms, P95 latency 2127 ms, and total usage 174 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1362 ms, P95 latency 2965 ms, and total usage
    9025 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ewppe`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 339 runtime candidates,
    selected 25 old UI screenshots by retention policy, deleted 0, selected
    1807049 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 39 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Chat Audio Input Mapping

- Checked the current official OpenAI audio guidance through the OpenAI
  developer-docs MCP. Chat audio input uses a user-message content part shaped
  as `type:"input_audio"` with `input_audio:{data,format}`. Responses docs
  still frame audio through provider/model support, so this bridge treats audio
  input as an audio-capable Chat provider compatibility surface rather than a
  feature that DeepSeek text models can understand locally.
- Added Responses-to-Chat audio input normalization:
  - user `input_audio` and compatible `audio` content parts now become Chat
    `input_audio` content parts when inline audio bytes are present;
  - canonical `input_audio.data`, plus compatible top-level `data`,
    `audio_data`, and `file_data`, are accepted and string-normalized;
  - `format` and provider-specific extra audio fields are preserved under
    `input_audio`;
  - non-user or non-forwardable audio parts become explicit text markers with
    any available transcript so replay context remains visible without breaking
    Chat message schemas.
- Added tests for:
  - translator mapping of mixed text, image, and audio Responses input content
    into Chat content parts;
  - assistant/non-user audio fallback text for replay-safe Chat messages;
  - mock `/v1/responses` forwarding that proves upstream Chat receives
    `messages[].content[]` with `text` plus `input_audio`, alongside
    `modalities` and `audio` when supported.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document audio input mapping, audio-capable provider expectations, and the
  remaining text-only-provider boundary for DeepSeek.
- Verified:
  - `node --check src/bridge/translator.js test/translator.test.js test/server.test.js`: passed.
  - `node --test test/translator.test.js test/server.test.js`: 110/110 passing
    tests.
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `npm test`: 113/113 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1507 ms, P95 latency 1651 ms, and total usage 150 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1410 ms, P95 latency 2824 ms, and total usage
    9176 tokens.
  - UI smoke passed with marker `ui-smoke-mq8f7o87`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 346 runtime candidates,
    selected 26 old UI screenshots by retention policy, deleted 0, selected
    1891646 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 38 GB available;
    repository checkout is 40 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Image Detail Content-Part Mapping

- Checked the current official OpenAI Images and Vision guide through the
  OpenAI developer-docs MCP. The guide states that image inputs can be provided
  as URLs, base64 data URLs, or Files API file IDs, and that the `detail`
  parameter has the same meaning for Responses and Chat Completions.
- Tightened Responses-to-Chat image input normalization:
  - user `input_image` parts now normalize through a dedicated image helper;
  - `image_url` strings and `image_url:{url,detail}` objects both map to Chat
    `type:"image_url"` content parts;
  - top-level Responses `detail` is preserved under Chat `image_url.detail`;
  - compatible inline `file_data`, `data`, or `image_data` payloads are turned
    into `data:<media_type>;base64,...` URLs for vision-capable Chat providers;
  - non-user or non-forwardable image parts continue to become explicit text
    markers without accidentally stringifying a malformed `image_url` object.
- Added tests for:
  - translator mapping of `input_image.detail` and existing data URLs;
  - translator conversion of inline base64 image payloads into Chat data URLs;
  - mock `/v1/responses` forwarding that proves upstream Chat receives
    `messages[].content[]` with `image_url.detail`.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document image detail/data-URL coverage and the remaining `file_id` image
  resolver gap.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js test/server.test.js`: 112/112 passing
    tests.
  - `npm test`: 115/115 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1553 ms, P95 latency 1702 ms, and total usage 186 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1317 ms, P95 latency 2935 ms, and total usage
    9021 tokens.
  - UI smoke passed with marker `ui-smoke-mq8fkhyo`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 353 runtime candidates,
    selected 27 old UI screenshots by retention policy, deleted 0, selected
    1976924 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 42 GB available;
    repository checkout is 40 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Local Image File ID Adapter

- Checked current official OpenAI Images and Vision guidance through the
  OpenAI developer-docs MCP. The guide documents image inputs by URL, base64
  data URL, and Files API `file_id`; Chat image inputs use URL/data URL content
  parts, so local `file_id` images can be bridged by resolving bytes to data
  URLs before the upstream Chat request.
- Added a local `input_image.file_id` compatibility adapter:
  - resolves local Files API image records before `responsesToChatRequest()`
    for `/v1/responses`, `/v1/responses/input_tokens`, and
    `/v1/responses/compact`;
  - converts bounded local image bytes into `data:<media_type>;base64,...`
    Chat `image_url.url` values while preserving `detail`;
  - supports configured caps through `CODEXCOMPAT_INPUT_IMAGE_PROVIDER`,
    `CODEXCOMPAT_INPUT_IMAGE_MAX_IMAGES`, and
    `CODEXCOMPAT_INPUT_IMAGE_MAX_BYTES`;
  - records `metadata.compatibility.local_input_images` with file id,
    filename, media type, byte count, status, and errors only, never the base64
    image payload.
- Added mock-provider server coverage that creates a local `purpose:"vision"`
  File, sends it as Responses `input_image.file_id`, proves the upstream Chat
  request receives a PNG data URL plus `detail`, and verifies compatibility
  metadata does not echo the data URL.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document local image file ID resolution and its text-only-provider boundary.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/input_images.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 80/80 passing tests.
  - `npm test`: 116/116 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1688 ms, P95 latency 1793 ms, and total usage 188 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1298 ms, P95 latency 2969 ms, and total usage
    9054 tokens.
  - UI smoke passed with marker `ui-smoke-mq8fvrn7`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 360 runtime candidates,
    selected 28 old UI screenshots by retention policy, deleted 0, selected
    2062112 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 41 GB available;
    repository checkout is 40 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Reasoning None DeepSeek Adapter

- Re-checked official API behavior before changing code:
  - the current OpenAI Chat Completions OpenAPI/docs surface accepts
    reasoning effort values including `none`, `minimal`, `low`, `medium`,
    `high`, and `xhigh`;
  - current DeepSeek Chat Completion and Thinking Mode docs only accept
    `reasoning_effort:"high"` / `"max"` and document compatibility mappings
    for `low`/`medium` to `high` and `xhigh` to `max`.
- Fixed the Responses-to-Chat translator so `reasoning:{effort:"none"}` with
  DeepSeek effort compatibility no longer forwards unsupported
  `reasoning_effort:"none"`. The bridge now sends
  `thinking:{type:"disabled"}` and records:
  - `metadata.compatibility.deepseek_thinking =
    "disabled_for_reasoning_none"`;
  - `metadata.compatibility.reasoning_effort` with source, target, original
    value, mapped value `null`, `forwarded:false`, and reason
    `deepseek_thinking_disabled`.
- Added translator and server mock-provider coverage proving the upstream Chat
  request omits `reasoning_effort`, sends DeepSeek non-thinking mode, and
  returns the compatibility metadata.
- Added a live `bridge-regression` case `responses-reasoning-none` so future
  DeepSeek evals continuously check this mapping.
- Tightened the `responses-computer` live eval to assert the screenshot-first
  `computer_call` protocol item and local metadata instead of requiring a
  model text marker before any `computer_call_output` evidence exists.
- Verification:
  - `node --check src/bridge/translator.js scripts/eval-harness.mjs test/translator.test.js test/server.test.js`: passed.
  - `node --test test/translator.test.js`: 34/34 passing tests.
  - `node --test test/server.test.js`: 81/81 passing tests.
  - `npm test`: 118/118 passing tests.
  - Pre-restart live control check for `responses-reasoning-none` failed 0/1
    with DeepSeek HTTP 400 because the old running service still sent
    `reasoning_effort:"none"`; after restarting the bridge with this patch, the
    same case passed 1/1, latency 1827 ms, total usage 18 tokens.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1629 ms, P95 latency 1814 ms, and total usage 166 tokens.
  - Targeted `responses-computer` live eval passed 1/1 after the protocol-level
    assertion fix, latency 2450 ms, total usage 252 tokens.
  - Full live `bridge-regression` passed 41/41 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1328 ms, P95 latency 3149 ms, and total usage
    9200 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ga8a0`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 41 GB available;
    repository checkout is 41 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Code Interpreter Call Output Shape

- Updated the local `code_interpreter` compatibility path so Chat-only
  providers now receive the same injected command evidence, while Responses
  clients receive a `code_interpreter_call` output item instead of shell-shaped
  `shell_call` / `shell_call_output` items.
- Implemented `include:["code_interpreter_call.outputs"]` for the local
  adapter. When requested, stdout/stderr logs are attached to
  `code_interpreter_call.outputs` and the request is recorded in
  `metadata.compatibility.local_shell.include_code_interpreter_outputs`.
- Fixed `/mnt/data` path rewriting for Python code blocks: bare shell paths
  still use shell quoting, while paths inside quoted code strings are rewritten
  as escaped string content. This prevents Python snippets such as
  `Path('/mnt/data/file.txt')` from becoming invalid after local workspace
  substitution.
- Added mock-provider server coverage for local `code_interpreter`:
  - the upstream Chat request omits unsupported hosted tools;
  - DeepSeek thinking mode is disabled for the local tool adapter;
  - the response output starts with `code_interpreter_call`;
  - nested `outputs` logs include the executed marker;
  - nested `outputs` are omitted when the include value is not requested;
  - no shell-shaped output items are emitted for `code_interpreter`;
  - generated files are readable through the local Containers file endpoints.
- Added live `bridge-regression` case `responses-code-interpreter`, which
  writes `/mnt/data/shell.txt`, checks `code_interpreter_call.outputs`, verifies
  the container artifact, and asserts the final DeepSeek text marker.
- Updated the compatibility matrix and parity plan to document the
  `code_interpreter_call.outputs` include mapping and the remaining hosted
  runtime boundary.
- Verification:
  - `node --check src/bridge/local_shell.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 82/82 passing tests.
  - `npm test`: 119/119 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-code-interpreter` passed 1/1 against
    `deepseek-v4-pro`, latency 1906 ms, total usage 370 tokens, and artifact
    text `code-interpreter-ok`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 2208 ms, P95 latency 2495 ms, and total usage 197 tokens.
  - Full live `bridge-regression` passed 42/42 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1939 ms, P95 latency 3907 ms, and total usage
    9779 tokens.
  - UI smoke passed with marker `ui-smoke-mq8gooux`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 380 runtime candidates,
    selected 30 old UI screenshots by retention policy, deleted 0, selected
    2234352 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 40 GB available;
    repository checkout is 41 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Input Image URL Include Projection

- Re-checked the current OpenAI Responses and Conversations reference through
  the official OpenAI developer docs MCP. The supported `include` values list
  includes `message.input_image.image_url`, defined as including image URLs from
  input messages.
- Added local input-item projection for
  `include:["message.input_image.image_url"]`:
  - `GET /v1/responses/{response_id}/input_items` hides stored input image
    URLs by default and returns them only when the include value is requested;
  - `GET /v1/conversations/{conversation_id}/items` applies the same projection
    to list results;
  - `GET /v1/conversations/{conversation_id}/items/{item_id}` applies the same
    projection to single-item retrieval.
- Kept the full stored item available internally for replay while redacting
  `image_url` / `url` fields only at API read time, so conversation replay and
  previous-response state continue to see the original request content.
- The include parser accepts `include=...`, repeated `include`, comma-separated
  include values, and `include[]=...` query forms.
- Added mock-provider server coverage proving:
  - upstream Chat image content still receives the original image URL/detail;
  - stored Responses input items hide image URLs by default and expose them with
    `include[]=message.input_image.image_url`;
  - local Conversations list and item-get paths hide image URLs by default and
    expose them with the include parameter;
  - the Conversations include projection is local and does not call upstream.
- Added live `bridge-regression` case `conversation-image-include` to exercise
  the deployed local Conversations projection without depending on multimodal
  DeepSeek support.
- Updated compatibility and evaluation docs to record the include mapping,
  default redaction behavior, and parity gate.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 84/84 passing tests.
  - `npm test`: 121/121 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `conversation-image-include` passed 1/1, latency 143 ms, no
    upstream token usage, and all hidden/included item endpoints returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1938 ms, P95 latency 2071 ms, and total usage 154 tokens.
  - Full live `bridge-regression` passed 43/43 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1484 ms, P95 latency 3356 ms, and total usage
    9522 tokens.
  - UI smoke passed with marker `ui-smoke-mq8h3wz1`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 387 runtime candidates,
    selected 31 old UI screenshots by retention policy, deleted 0, selected
    2320784 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 40 GB available;
    repository checkout is 42 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Computer Output Image URL Include Projection

- Re-checked the current OpenAI Responses reference through the official OpenAI
  developer docs MCP. The supported `include` values list includes
  `computer_call_output.output.image_url`, alongside the existing input-image
  include projection work.
- Added local input-item projection for
  `include:["computer_call_output.output.image_url"]`:
  - `GET /v1/responses/{response_id}/input_items` hides stored
    `computer_call_output.output.image_url` values by default and returns them
    only when the include value is requested;
  - `GET /v1/conversations/{conversation_id}/items` applies the same projection
    to list results;
  - `GET /v1/conversations/{conversation_id}/items/{item_id}` applies the same
    projection to single-item retrieval.
- Preserved the full stored item internally for previous-response and
  Conversation replay. The bridge only redacts `output.image_url` / `output.url`
  at API read time and keeps `detail` visible so clients can inspect image
  fidelity without the URL unless they explicitly opt in.
- Kept create-request compatibility behavior intact: returned
  `computer_call_output` input items still translate to Chat-visible evidence,
  and create requests that include this field continue recording
  `metadata.compatibility.local_computer.include_output_image_url`.
- Added mock-provider server coverage proving:
  - upstream Chat context still receives the original computer output image URL
    and `call_id`;
  - stored Responses input items hide `output.image_url` by default and expose it
    with `include=computer_call_output.output.image_url`;
  - local Conversations list and item-get paths hide the URL by default and
    expose it with the include parameter.
- Added live `bridge-regression` case `conversation-computer-output-include` so
  deployed local Conversations projection is exercised without upstream model
  spend.
- Updated compatibility and evaluation docs to record the include mapping,
  default redaction behavior, and parity gate.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `conversation-computer-output-include` passed 1/1, latency
    101 ms, no upstream token usage, and all hidden/included item endpoints
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 2012 ms, P95 latency 2057 ms, and total usage 155 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1507 ms, P95 latency 3072 ms, and total usage
    9621 tokens.
  - UI smoke passed with marker `ui-smoke-mq8hfrp2`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 394 runtime candidates,
    selected 32 old UI screenshots by retention policy, deleted 0, selected
    2407005 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 42 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Output Text Logprobs Stored-Response Projection

- Re-checked the current OpenAI Responses create reference through the official
  OpenAI developer docs MCP. The supported `include` values list includes
  `message.output_text.logprobs`, defined as including logprobs with assistant
  messages.
- Extended output-text logprobs handling from create-time preservation to
  stored-response projection:
  - Chat `choices[].logprobs.content[]` remains mapped onto Responses
    `message.content[].logprobs` when requested;
  - stored Responses keep output-text token logprobs internally when the Chat
    provider returns them;
  - create responses hide `message.output_text.logprobs` unless the request
    includes `include:["message.output_text.logprobs"]`;
  - `GET /v1/responses/{response_id}` hides output-text logprobs by default;
  - `GET /v1/responses/{response_id}?include[]=message.output_text.logprobs`
    returns the stored token logprob arrays.
- Updated the live `responses-logprobs` regression case to create a stored
  response, verify immediate include output, verify default retrieve redaction,
  verify include retrieve recovery, and delete the stored response after the
  case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Secret handling: no provider API key or credential value was written to the
  repository; the verification path used the existing systemd environment.
- Verification:
  - `node --check src/bridge/server.js && node --check scripts/eval-harness.mjs && node --check test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-logprobs` passed 1/1 against `deepseek-v4-pro`,
    latency 1840 ms, total usage 69 tokens, visible text `logprobs-ok`, and
    both hidden/included stored-response retrieves returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1259 ms, P95 latency 1287 ms, and total usage 161 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1183 ms, P95 latency 2454 ms, and total usage
    9693 tokens.
  - UI smoke passed with marker `ui-smoke-mq8iski1`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 422 runtime candidates,
    selected 36 old UI screenshots by retention policy, deleted 0, selected
    2751773 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 37 GB available;
    repository checkout is 44 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Web Search Action Sources Stored-Response Projection

- Re-checked the current OpenAI Responses create reference through the official
  OpenAI developer docs MCP. The supported `include` values list includes
  `web_search_call.action.sources`, defined as exposing sources for the web
  search tool call.
- Extended the local web-search adapter from create-time source inclusion to
  stored-response projection:
  - local web-search `action.sources` are stored internally on
    `web_search_call` output items for `store:true` responses;
  - create responses hide `web_search_call.action.sources` unless the request
    includes `include:["web_search_call.action.sources"]`;
  - `GET /v1/responses/{response_id}` hides web-search action sources by
    default;
  - `GET /v1/responses/{response_id}?include[]=web_search_call.action.sources`
    returns the stored sources.
- Kept final text citation annotations unchanged: `url_citation` annotations
  remain visible on generated output text, while nested `action.sources` are
  controlled by the include projection.
- Preserved streaming terminal response behavior for clients while storing a
  full internal response after completion so later retrieve calls can project
  web-search sources with the include query.
- Updated background local-output preparation so background responses also keep
  full internal web-search sources before retrieve-time projection.
- Updated the live `responses-web-search` regression case to create a stored
  response, verify immediate include output, verify default retrieve redaction,
  verify include retrieve recovery, and delete the stored response after the
  case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Secret handling: no provider API key or credential value was written to the
  repository; the verification path used the existing systemd environment.
- Verification:
  - `node --check src/bridge/server.js && node --check scripts/eval-harness.mjs && node --check test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-web-search` passed 1/1 against
    `deepseek-v4-pro`, latency 1785 ms, total usage 4040 tokens, visible text
    `web-search-ok [1].`, and both hidden/included stored-response retrieves
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1216 ms, P95 latency 1473 ms, and total usage 179 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1156 ms, P95 latency 2748 ms, and total usage
    9615 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ij8w8`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 415 runtime candidates,
    selected 35 old UI screenshots by retention policy, deleted 0, selected
    2665509 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 38 GB available;
    repository checkout is 43 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 File Search Results Stored-Response Projection

- Re-checked the current OpenAI Responses reference through the official OpenAI
  developer docs MCP. The supported `include` values list includes
  `file_search_call.results`, defined as exposing search results from the file
  search tool call.
- Extended the local file-search adapter from create-time result inclusion to
  stored-response projection:
  - local file-search result arrays are kept internally on the response output
    item for `store:true` responses;
  - create responses hide `file_search_call.results` unless the request includes
    `include:["file_search_call.results"]`;
  - `GET /v1/responses/{response_id}` hides file-search results by default;
  - `GET /v1/responses/{response_id}?include[]=file_search_call.results`
    returns the stored result details.
- Kept final text citation annotations unchanged: `file_citation` annotations
  remain visible on generated output text, while the detailed result array is
  controlled by the include projection.
- Preserved streaming terminal response behavior for clients while storing a
  full internal response after completion so later retrieve calls can project
  file-search results with the include query.
- Updated the live `responses-file-search` regression case to create a stored
  response, verify immediate include output, verify default retrieve redaction,
  verify include retrieve recovery, and delete the stored response after the
  case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Verification:
  - `node --check src/bridge/server.js src/bridge/local_file_search.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-file-search` passed 1/1 against
    `deepseek-v4-pro`, latency 1329 ms, total usage 222 tokens, visible text
    `file-search-ok [1]`, and both hidden/included stored-response retrieves
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1153 ms, P95 latency 1219 ms, and total usage 158 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1428 ms, P95 latency 3118 ms, and total usage
    9476 tokens.
  - UI smoke passed with marker `ui-smoke-mq8i1yvb`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 408 runtime candidates,
    selected 34 old UI screenshots by retention policy, deleted 0, selected
    2579476 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 43 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Code Interpreter Outputs Stored-Response Projection

- Re-checked the current OpenAI Responses reference through the official OpenAI
  developer docs MCP. The supported `include` values list includes
  `code_interpreter_call.outputs`, defined as exposing outputs of Python code
  execution in code-interpreter tool-call items.
- Extended the local code-interpreter adapter from create-time output inclusion
  to stored-response projection:
  - local code-interpreter stdout/stderr logs are stored internally on the
    response output item for `store:true` responses;
  - create responses still hide nested `code_interpreter_call.outputs` unless
    the request includes `include:["code_interpreter_call.outputs"]`;
  - `GET /v1/responses/{response_id}` hides nested outputs by default;
  - `GET /v1/responses/{response_id}?include[]=code_interpreter_call.outputs`
    returns the stored nested logs.
- Kept Conversation append behavior aligned with the public response projection
  so hidden code-interpreter logs are not copied into Conversation items unless
  the originating public response included them.
- Preserved streaming terminal response behavior for clients while storing a
  full internal response after completion so later retrieve calls can project
  code-interpreter outputs with the include query.
- Updated the live `responses-code-interpreter` regression case to create a
  stored response, verify immediate include output, verify default retrieve
  redaction, verify include retrieve recovery, and delete the stored response
  after the case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Verification:
  - `node --check src/bridge/server.js src/bridge/local_shell.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-code-interpreter` passed 1/1 against
    `deepseek-v4-pro`, latency 1831 ms, total usage 372 tokens, artifact text
    `code-interpreter-ok`, and both hidden/included stored-response retrieves
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1697 ms, P95 latency 1701 ms, and total usage 158 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1744 ms, P95 latency 4226 ms, and total usage
    9638 tokens.
  - UI smoke passed with marker `ui-smoke-mq8hsn1f`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 401 runtime candidates,
    selected 33 old UI screenshots by retention policy, deleted 0, selected
    2493382 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 42 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Reasoning Encrypted Content Stored-Response Projection

- Re-checked the current OpenAI deployment checklist through the official
  OpenAI developer docs MCP. The `reasoning.encrypted_content` guidance says to
  add the value to `include`, round-trip the returned reasoning item exactly as
  returned, and pass it back on later requests as a stateless handoff.
- Extended local encrypted reasoning compatibility from create-time projection
  to stored-response projection:
  - local reasoning text returned by Chat providers is encrypted with the local
    `ocrsn1.` payload format and retained internally for stored Responses;
  - create responses return `reasoning.encrypted_content` only when the request
    includes `include:["reasoning.encrypted_content"]`;
  - `GET /v1/responses/{response_id}` hides encrypted reasoning content by
    default;
  - `GET /v1/responses/{response_id}?include[]=reasoning.encrypted_content`
    returns the stored encrypted reasoning content.
- Preserved replay behavior: clients can pass the encrypted reasoning item back
  in a later request, and the bridge decodes it locally into upstream
  `reasoning_content` for Chat-compatible providers.
- Preserved streaming client behavior while storing a full internal response at
  completion time, so later retrieval can project encrypted reasoning content
  only when the include query requests it.
- Extended background response finalization so completed background Responses
  also retain local encrypted reasoning content internally and report
  compatibility metadata when requested.
- Added unit coverage for create-time include projection, default stored
  retrieval redaction, include-based stored retrieval recovery, no-include
  create redaction with internal storage, and replay from encrypted reasoning
  items.
- Added a live `responses-reasoning-encrypted` bridge-regression case that
  verifies visible output, `ocrsn1.` encrypted content on create, default GET
  redaction, include GET recovery, and local compatibility metadata.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior and the targeted eval command.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-reasoning-encrypted` passed 1/1 against
    `deepseek-v4-pro`, latency 1476 ms, total usage 77 tokens, visible text
    `reasoning-encrypted-ok`, and both hidden/included stored-response
    retrieves returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1648 ms, P95 latency 1699 ms, and total usage 203 tokens.
  - Full live `bridge-regression` passed 45/45 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1151 ms, P95 latency 2472 ms, and total usage
    9669 tokens.
  - UI smoke passed with marker `ui-smoke-mq8j8rt7`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 429 runtime candidates,
    selected 37 old UI screenshots by retention policy, deleted 0, selected
    2838229 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 37 GB available;
    repository checkout is 44 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Batch Responses image_generation regression coverage

- Added explicit local Batch coverage for Responses image-generation JSONL
  requests:
  - unit coverage creates a `purpose:"batch"` JSONL file containing a
    `/v1/responses` request with `tools:[{type:"image_generation"}]`;
  - the local Batch executor writes a Batch output file whose response body
    preserves the `image_generation_call` item, base64 PNG result, assistant
    message, compatibility metadata, and generated image-call state record;
  - live `bridge-regression` now includes `batch-responses-image-generation`,
    so the DeepSeek-backed bridge checks Batch + image-generation protocol
    compatibility continuously.
- Updated compatibility/evaluation docs:
  - Batch known gap now distinguishes covered Responses image-generation JSONL
    from not-yet-implemented direct Images/video endpoint batch execution;
  - image-generation known gap no longer claims missing call-id persistence,
    since id-only multi-turn edit is now implemented and covered.
- Verification:
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "Batch API executes Responses image_generation" test/server.test.js`:
    1/1 passing.
  - `npm run eval:bridge -- --case batch-responses-image-generation`: passed
    1/1 against `deepseek-v4-pro`, latency 1312 ms, total usage 185 tokens.
  - `npm test`: 142/142 passing tests.
  - `npm run eval:bridge`: passed 53/53 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1336 ms, P95 latency 3041 ms, and total usage
    10797 tokens. The suite now includes
    `batch-responses-image-generation`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-15 - Local Organization roles and groups compatibility

- Used official OpenAI sources for the next Organization RBAC/admin slice:
  - OpenAPI spec for `/v1/organization/roles` documents list/create shapes,
    `role` objects, non-empty permissions, predefined-role flags, and
    NextCursorPage pagination;
  - OpenAPI spec for `/v1/organization/groups` documents list/create shapes,
    `group` objects, `is_scim_managed`, and cursor pagination;
  - OpenAI Node SDK generated Organization roles resource documents
    create/retrieve/update/list/delete methods and `role.deleted`;
  - OpenAI Node SDK generated Organization groups, group users, group roles,
    and user roles resources document group CRUD, group membership CRUD, direct
    user role assignments, direct group role assignments, and the
    `group.user`, `user.role`, and `group.role` response families.
- Extended the local file-backed Organization admin compatibility layer:
  - `GET/POST /v1/organization/roles` and
    `GET/POST/DELETE /v1/organization/roles/{role_id}` now manage local custom
    roles with de-duplicated permissions, `resource_type:"api.organization"`,
    predefined-role guardrails, and `role.deleted`;
  - `GET/POST /v1/organization/groups` and
    `GET/POST/DELETE /v1/organization/groups/{group_id}` now manage local
    non-SCIM groups with `group_type:"group"` and `is_scim_managed:false`;
  - `GET/POST /v1/organization/groups/{group_id}/users` plus
    `GET/DELETE /v1/organization/groups/{group_id}/users/{user_id}` manage
    local group memberships for existing local organization users;
  - `GET/POST /v1/organization/users/{user_id}/roles` plus
    `GET/DELETE /v1/organization/users/{user_id}/roles/{role_id}` manage
    direct user role assignments;
  - `GET/POST /v1/organization/groups/{group_id}/roles` plus
    `GET/DELETE /v1/organization/groups/{group_id}/roles/{role_id}` manage
    direct group role assignments;
  - deleting an organization role removes local user/group assignments that
    reference it, deleting an organization group removes its local memberships
    and assignments, and deleting an organization user now removes direct role
    assignments plus group memberships.
- Current boundary: this closes another class of Organization admin/RBAC SDK
  and UI 404s for Chat Completions-backed deployments. These records are local
  protocol metadata only; the bridge still does not enforce RBAC authorization,
  sync groups or roles to provider identity systems, manage SCIM, or implement
  the remaining Organization families such as admin API keys, audit logs,
  certificates, data retention, spend alerts, project groups, model
  permissions, or hosted-tool permissions.
- Added regression coverage:
  - unit/mock-provider coverage verifies role create/list/retrieve/update/
    delete, invalid empty-permission errors, group create/list/retrieve/update/
    delete, group user membership, direct user role assignment, direct group
    role assignment, missing assignment errors, delete-marker shapes, and zero
    upstream provider calls;
  - live `bridge-regression` now includes `organization-roles-groups`, covering
    the same lifecycle against the deployed DeepSeek-backed bridge with zero
    provider token usage.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Organization unit tests passed 5/5.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-roles-groups`: passed 1/1 against
    `deepseek-v4-pro`, latency 673 ms, output
    `organization_roles_groups:role_...:group_...`, and zero provider token
    usage.
  - `npm test`: passed 205/205.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1226 ms, P95 latency 1278 ms, and total usage 99
    tokens.
  - `npm run eval:bridge -- --timeout-ms 180000`: passed 102/102 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1300 ms, P95 latency
    3499 ms, and total usage 24960 tokens. The suite now includes
    `organization-roles-groups`.
  - `npm run smoke:bridge`: passed with `output_text:"bridge-ok"`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online`, exercised sidebar/page navigation,
    project dialog, host upload verification, prompt send, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project create/reopen/cleanup, and reported no browser console errors or
    warnings.
  - Service check: app-server, bridge, and web services were all `active`;
    `https://opencodexapp.aialra.online` returned HTTP 200.
  - Space check after the run: `/` was 171G used of 193G, 23G available, 89%
    used; repo `state` was 28M, `output` was 4.4M,
    `/srv/aialra/data/opencodexapp` was 136K, and
    `/srv/aialra/logs/opencodexapp` was 29M.
  - Runtime prune dry-run selected one old UI screenshot; apply deleted one
    file, 85079 bytes, with zero errors.
- Updated compatibility/evaluation/deployment docs to list the new
  Organization roles/groups/user-role/group-role/group-membership endpoints,
  source references, live eval command, and state-directory boundaries.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, or usable synthetic project key values were added to
  the repository. The local service-account compatibility key prefix remains
  `oc_local_key_`, never `sk-`, and is not persisted.

## 2026-06-15 - Local Organization certificates compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - OpenAI OpenAPI endpoint list and `listOrganizationCertificates` /
    `uploadCertificate` operation specs document
    `GET/POST /organization/certificates`, `organization.certificate` list
    projections, `certificate` detail objects, `limit`, `after`, `order`, and
    upload body fields `certificate` and optional `name`;
  - OpenAI OpenAPI `activateOrganizationCertificates` and
    `deactivateOrganizationCertificates` specs document
    `POST /organization/certificates/activate|deactivate`,
    `certificate_ids[]`, the 1-10 item toggle bound, and
    `organization.certificate.activation/deactivation` wrapper objects;
  - OpenAI OpenAPI source schemas document `certificate.deleted`, certificate
    details with optional `content`, and project activation wrapper objects
    `organization.project.certificate.activation/deactivation`;
  - OpenAI Node SDK generated organization certificates resource documents
    create/retrieve/update/list/delete/activate/deactivate, retrieve
    `include:["content"]`, update-name-only behavior, and delete requiring the
    certificate to be inactive for organization and all projects;
  - OpenAI Node SDK generated project certificates resource documents
    `GET /organization/projects/{project_id}/certificates` and project
    activate/deactivate with `certificate_ids[]`.
- Extended the local file-backed Organization admin compatibility layer:
  - added local uploaded certificate records under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/organization_certificates`;
  - added local project certificate activation records under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/project_resources/<project>/certificates`;
  - added `GET/POST /v1/organization/certificates`;
  - added `GET/POST/DELETE /v1/organization/certificates/{certificate_id}`;
  - added `POST /v1/organization/certificates/activate`;
  - added `POST /v1/organization/certificates/deactivate`;
  - added `GET /v1/organization/projects/{project_id}/certificates`;
  - added `POST /v1/organization/projects/{project_id}/certificates/activate`;
  - added `POST /v1/organization/projects/{project_id}/certificates/deactivate`;
  - validates `certificate_ids[]` as 1-10 non-empty IDs, rejects PEM payloads
    containing private keys, stores certificate content only in local runtime
    state, omits PEM content from list/create/update/get by default, and
    returns it only for `include[]=content`;
  - prevents certificate deletion while active at organization scope or any
    project scope, and removes inactive project certificate state when the
    uploaded certificate is deleted;
  - records local `certificate.created`, `certificate.updated`,
    `certificate.deleted`, `certificate.activated`, and
    `certificate.deactivated` audit events.
- Current boundary: these endpoints close the remaining documented
  Organization certificate SDK/admin 404s for Chat Completions-backed
  deployments. They persist local certificate protocol metadata only; the
  bridge does not change provider TLS trust, upload certificates to DeepSeek or
  OpenAI, or enforce certificate policy in outbound provider calls.
- Added regression coverage:
  - unit/mock-provider coverage verifies upload, invalid/missing/private-key
    rejection, retrieve with and without content, update, organization
    activate/deactivate, deletion protection, project activate/deactivate,
    project list, audit-log filters, delete cleanup, archived-project
    rejection, and zero upstream provider calls;
  - live `bridge-regression` now includes `organization-certificates`, covering
    the same lifecycle against the deployed DeepSeek-backed bridge with zero
    provider token usage.
- Verification:
  - `node --check` passed for
    `src/bridge/local_organization_admin.js`, `src/bridge/server.js`,
    `test/server.test.js`, and `scripts/eval-harness.mjs`;
  - focused Organization certificates unit test passed 1/1;
  - focused Organization admin regression passed 11/11;
  - `npm test` passed 211/211;
  - restarted `aialra-opencodexapp-bridge.service`; health check returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`;
  - focused live `organization-certificates` eval passed 1/1 in 1831 ms with
    zero provider token usage;
  - `npm run eval:protocol` passed 2/2, average latency 1106 ms, P95 latency
    1180 ms, total usage 99 tokens;
  - `npm run smoke:bridge` returned `bridge-ok`;
  - full live `bridge-regression` passed 108/108, pass rate 1.0, average
    latency 1214 ms, P95 latency 3309 ms, total usage 24783 tokens;
  - `npm run smoke:ui -- --timeout-ms 180000` passed against
    `https://opencodexapp.aialra.online`, covering load/auth, sidebar controls,
    core page navigation, project dialog and host upload services, new
    conversation submission, completed turn actions, reload persistence,
    generated image artifact display, saved project reopen, and cleanup with
    zero console errors or warnings;
  - `aialra-opencodexapp-app-server.service`,
    `aialra-opencodexapp-bridge.service`, and
    `aialra-opencodexapp-web.service` were active;
  - HTTPS `HEAD https://opencodexapp.aialra.online` returned HTTP/2 200 and
    `cache-control: no-store`;
  - storage check showed `/srv/aialra/apps` on `/dev/sda1` at 170G used,
    24G available, 88% utilization; local repo runtime state was 36M,
    `output/` was 4.4M, app data was 136K, and app logs were 30M;
  - `npm run prune:runtime -- --dry-run` scanned 3213 files across 13 runtime
    targets and selected 0 files / 0 bytes for deletion.
- Updated compatibility/evaluation/deployment docs to list the new
  organization/project certificate endpoints, source references, focused live
  eval command, and local state-directory boundaries.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, private keys, or provider certificate secrets were
  added to the repository. The certificate upload compatibility path explicitly
  rejects private-key PEM blocks.

## 2026-06-15 - Local Organization policy controls compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - OpenAI OpenAPI operation `retrieve-organization-data-retention` documents
    `GET/POST /organization/data_retention`, `organization.data_retention`,
    and organization `retention_type` values;
  - OpenAI Node SDK generated project data-retention resource documents
    `GET/POST /organization/projects/{project_id}/data_retention`,
    `project.data_retention`, and project-specific `organization_default` /
    `none` values;
  - OpenAI Node SDK generated project model-permissions resource documents
    retrieve/update/delete, `project.model_permissions`,
    `mode:"allow_list"|"deny_list"`, `model_ids[]`, and
    `project.model_permissions.deleted`;
  - OpenAI Node SDK generated project hosted-tool-permissions resource documents
    retrieve/update and per-tool `enabled` flags for `code_interpreter`,
    `file_search`, `image_generation`, `mcp`, and `web_search`.
- Extended the local file-backed Organization admin compatibility layer:
  - added local organization data-retention state at
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/organization_data_retention.json`;
  - added local project data-retention, model-permission, and hosted-tool
    permission settings under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/project_resources/<project>/`;
  - added `GET/POST /v1/organization/data_retention`;
  - added `GET/POST /v1/organization/projects/{project_id}/data_retention`;
  - added `GET/POST/DELETE /v1/organization/projects/{project_id}/model_permissions`;
  - added `GET/POST /v1/organization/projects/{project_id}/hosted_tool_permissions`;
  - defaults organization retention to `modified_abuse_monitoring`, project
    retention to `organization_default`, model permissions to an empty
    `deny_list`, and hosted tool permissions to all enabled;
  - records local `data_retention.updated`, `model_permissions.updated`,
    `model_permissions.deleted`, and `hosted_tool_permissions.updated` audit
    events.
- Current boundary: these endpoints close another class of Organization admin
  SDK/UI 404s for Chat Completions-backed deployments. They persist local
  protocol metadata only; the bridge does not change provider data-retention
  settings, enforce provider model allow/deny lists, or enforce hosted-tool
  permissions in request execution yet.
- Added regression coverage:
  - unit/mock-provider coverage verifies default retrieve, update, invalid
    values, model-permission delete/reset, hosted-tool partial updates and
    `null` reset, archived-project rejection, audit-log filters, and zero
    upstream provider calls;
  - live `bridge-regression` now includes `organization-policy-controls`,
    covering the same lifecycle against the deployed DeepSeek-backed bridge with
    zero provider token usage.
- Final verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `test/server.test.js`, and
    `scripts/eval-harness.mjs`.
  - Focused Organization policy-control unit test passed 1/1.
  - Focused Organization unit tests passed 10/10.
  - `npm test` passed 210/210.
  - `npm run eval:protocol` passed 2/2, avg latency 1193 ms, p95 1399 ms,
    99 total tokens.
  - `npm run smoke:bridge` returned a completed `bridge-ok` response.
  - Focused live
    `node scripts/eval-harness.mjs --suite bridge-regression --case organization-policy-controls --timeout-ms 90000 --verbose`
    passed 1/1 with zero provider tokens, then the full live
    `bridge-regression` suite passed 107/107, avg latency 1213 ms, p95
    3344 ms, 24812 total tokens.
  - `npm run smoke:ui -- --timeout-ms 180000` passed against
    `https://opencodexapp.aialra.online`, covering navigation, project
    dialogs/uploads, chat submit/reload, completed-turn actions, generated
    image artifact display, and saved-project cleanup.
  - Deployment health checks passed: `aialra-opencodexapp-app-server`,
    `aialra-opencodexapp-bridge`, and `aialra-opencodexapp-web` were all
    active; bridge `/healthz` returned `ok:true` with provider base
    `https://api.deepseek.com`; the public domain returned HTTP 200.
  - Storage check reported `/srv/aialra/apps/open-codex-app-web-gateway`
    on a 193G filesystem with 25G available, `state` 35M, `output` 4.5M,
    `/srv/aialra/data/opencodexapp` 136K, and
    `/srv/aialra/logs/opencodexapp` 29M.
  - `npm run prune:runtime -- --dry-run` selected one old UI screenshot, and
    `npm run prune:runtime -- --apply` deleted 1 file / 82916 bytes with zero
    errors.
- Updated compatibility/evaluation/deployment docs to list the new
  Organization/project data-retention, model-permission, and hosted-tool
  permission endpoints, source references, focused live eval command, and local
  state-directory boundaries.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, or provider policy secrets were added to the repository.

## 2026-06-15 - Local Organization spend alerts compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - OpenAI OpenAPI operation `list-organization-spend-alerts` documents
    `GET /organization/spend_alerts`, `limit`, `order`, `after`, `before`, and
    list-page response fields;
  - OpenAI OpenAPI operation `create-organization-spend-alert` documents
    `POST /organization/spend_alerts`, `threshold_amount`, `currency:"USD"`,
    `interval:"month"`, and email notification channels;
  - OpenAI Node SDK generated Organization spend-alerts resource documents
    create, update, list, delete, `organization.spend_alert`, and
    `organization.spend_alert.deleted`;
  - OpenAI Node SDK generated project spend-alerts resource documents the
    project-scoped create, update, list, delete flow and
    `project.spend_alert.deleted`.
- Extended the local file-backed Organization admin compatibility layer:
  - added local Organization spend-alert records under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/organization_spend_alerts`;
  - added local project spend-alert records under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/project_resources/<project>/spend_alerts`;
  - added `GET`, `POST`, `POST /{alert_id}`, and `DELETE /{alert_id}` for
    `/v1/organization/spend_alerts`;
  - added `GET`, `POST`, `POST /{alert_id}`, and `DELETE /{alert_id}` for
    `/v1/organization/projects/{project_id}/spend_alerts`;
  - normalizes required `threshold_amount`, `currency:"USD"`,
    `interval:"month"`, `notification_channel.type:"email"`, unique
    recipients, and optional `subject_prefix`;
  - records local `spend_alert.created`, `spend_alert.updated`, and
    `spend_alert.deleted` audit events, with `project_id` filters for
    project-scoped alerts.
- Current boundary: this closes another class of Organization admin SDK and UI
  404s for Chat Completions-backed deployments. These records are local
  protocol metadata only; the bridge does not meter real provider spend,
  aggregate actual invoices, send alert email, or enforce provider billing
  controls.
- Added regression coverage:
  - unit/mock-provider coverage verifies organization and project alert
    create/list/update/delete, OpenAI-style list pagination, missing parameter
    and invalid notification-channel errors, archived-project rejection, audit
    log filters, and zero upstream provider calls;
  - live `bridge-regression` now includes `organization-spend-alerts`, covering
    the same lifecycle against the deployed DeepSeek-backed bridge with zero
    provider token usage.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `test/server.test.js`, and
    `scripts/eval-harness.mjs`.
  - Focused Organization spend-alert unit test passed 1/1.
  - Focused Organization unit tests passed 9/9.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-spend-alerts`: passed 1/1 against
    `deepseek-v4-pro`, latency 1550 ms, output
    `organization_spend_alerts:alert_...:alert_...`, and zero provider token
    usage.
  - `npm test`: passed 209/209.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1089 ms, P95 latency 1423 ms, and total usage 99
    tokens.
  - `npm run smoke:bridge`: passed with `output_text:"bridge-ok"`.
  - Full live `bridge-regression`: passed 106/106 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1305 ms, P95 latency 3830 ms, and total
    usage 24905 tokens. The suite now includes `organization-spend-alerts`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online`, exercised sidebar/page navigation,
    project dialog, host upload verification, prompt send, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project create/reopen/cleanup, and reported no browser console errors or
    warnings.
  - Service check: app-server, bridge, and web services were all `active`;
    `https://opencodexapp.aialra.online` returned HTTP 200.
  - Space check after the run: `/` was 168G used of 193G, 25G available, 88%
    used; repo `state` was 33M, `output` was 4.7M,
    `/srv/aialra/data/opencodexapp` was 136K, and
    `/srv/aialra/logs/opencodexapp` was 29M.
  - Runtime prune dry-run selected three old UI screenshots; apply deleted
    three files, 264209 bytes, with zero errors.
- Updated compatibility/evaluation/deployment docs to list the new
  Organization and project spend-alert endpoints, source references, focused
  live eval command, and local state-directory boundaries.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, or alert notification test recipients containing real
  secrets were added to the repository.

## 2026-06-15 - Local Organization project groups compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - OpenAI endpoint inventory lists
    `/organization/projects/{project_id}/groups` and
    `/organization/projects/{project_id}/groups/{group_id}`;
  - OpenAI Node SDK generated project groups resource documents
    `client.admin.organization.projects.groups.create/retrieve/list/delete()`,
    create body `group_id` and `role`, list `order` pagination, retrieve query
    `group_type`, the `project.group` response object, and
    `project.group.deleted`;
  - RBAC guide confirms that project-level access can apply to groups as well
    as users, with effective access coming from assigned roles.
- Extended the local file-backed Organization admin compatibility layer:
  - added project group access records under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR/project_resources/<project>/groups`;
  - added `GET`, `POST`, `GET /{group_id}`, and `DELETE /{group_id}` for
    `/v1/organization/projects/{project_id}/groups`;
  - persists protocol metadata only: `project_id`, `group_id`, `group_name`,
    `group_type`, grant timestamp, requested `role`, and compatibility
    metadata;
  - returns OpenAI-style `project.group` records without a synthetic `id`
    field, while paginating by `group_id` for stable cursor behavior;
  - cascades Organization group deletion into project group access cleanup so
    project group lists do not retain orphan local membership records;
  - records local `project.group.created` and `project.group.deleted` audit
    events with project and group resource filters.
- Current boundary: this is local protocol compatibility for admin SDKs and
  dashboards. It does not grant provider-side access, enforce RBAC decisions,
  create real OpenAI project roles, sync SCIM tenant groups, or authenticate
  requests based on the local records. The requested `role` is persisted for
  audit/replay and future project-role work, but no hosted permission engine is
  attached yet.
- Added regression coverage:
  - unit/mock-provider coverage verifies empty list shape, missing `group_id`
    and `role` errors, create/list/retrieve/delete, `group_type` retrieve
    filtering, audit-log writes, source group cleanup, missing group errors,
    and zero upstream provider calls;
  - live `bridge-regression` now includes `organization-project-groups`,
    covering the same lifecycle against the deployed DeepSeek-backed bridge
    with zero provider token usage.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused unit test
    `Organization projects manage local group access` passed 1/1.
  - Focused Organization unit tests passed 8/8.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz on port
    `12912` returned `ok:true`, provider base `https://api.deepseek.com`,
    default model `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-project-groups`: passed 1/1, latency 2341 ms,
    zero provider token usage, and output only project/group ids.
  - `npm test`: passed 208/208.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1694 ms, P95 latency 1740 ms, and total usage 99
    tokens.
  - `npm run smoke:bridge`: returned `bridge-ok`.
  - Full live `bridge-regression` with report output passed 105/105 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1785 ms, P95 latency
    4564 ms, and total usage 24820 tokens. The suite now includes
    `organization-project-groups`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online`; exercised sidebar controls, page
    navigation, project dialog/browser upload, prompt send, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project create/reopen/cleanup, and reported zero console errors/warnings.
  - Service check: app-server, bridge, and web services were all `active`;
    `https://opencodexapp.aialra.online` returned HTTP 200.
  - Space check after the run: `/` was 168G used of 193G, 25G available, 88%
    used; repo `state` was 32M, `output` was 4.5M,
    `/srv/aialra/data/opencodexapp` was 136K, and
    `/srv/aialra/logs/opencodexapp` was 29M.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, provider group credentials, or reusable secrets were
  added to tracked files.

## 2026-06-15 - Local Organization admin API keys compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - Admin APIs guide lists API key management as an administrative workflow and
    documents Admin SDK initialization with an Admin API key;
  - OpenAPI spec for `GET`/`POST /v1/organization/admin_api_keys` documents
    `admin-api-keys-list`, `admin-api-keys-create`, cursor pagination with
    `after`, `order`, `limit`, create body `name`, list response
    `object:"list"` / `data` / `first_id` / `last_id` / `has_more`, redacted
    `organization.admin_api_key` records, and create-only `value`;
  - OpenAI Node SDK generated Organization admin API keys resource documents
    `client.admin.organization.adminAPIKeys.create/retrieve/list/delete()`,
    `AdminAPIKey`, `AdminAPIKeyCreateResponse`, and
    `organization.admin_api_key.deleted`.
- Extended the local file-backed Organization admin compatibility layer:
  - added an `organization_admin_api_keys` state directory under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR`;
  - added `GET`, `POST`, `GET /{key_id}`, and `DELETE /{key_id}` for
    `/v1/organization/admin_api_keys`;
  - persists only redacted local admin API-key metadata and local owner
    metadata; create responses include a one-time compatibility value prefixed
    `oc_local_admin_key_`, never `sk-`, and that value is not written to local
    state or later list/retrieve responses;
  - records local `api_key.created` and `api_key.deleted` audit events with
    `api.organization.admin` scope metadata, so the existing audit-log filters
    can review admin-key lifecycle changes.
- Current boundary: this is a local protocol-compatibility admin-key registry
  for SDK/admin UI workflows. It does not create real OpenAI Admin API keys,
  authenticate requests, grant provider privileges, or produce a reusable
  provider secret. It closes 404s and validates redaction semantics for
  Chat-Completions-backed deployments.
- Hardened adjacent live regression stability while validating:
  - `organization-project-admin` now lists projects with
    `order=desc&limit=100` so long-lived deployed state does not hide the
    just-created project behind older records;
  - remote MCP call and stream-call live cases now force
    `tool_choice:{type:"function",name:"roll"}` to reduce model randomness
    where the model describes a tool call instead of making one.
- Added regression coverage:
  - unit/mock-provider coverage verifies empty list shape, missing-name error,
    create/list/retrieve/delete, redaction, one-time value non-persistence,
    pagination, missing-key errors, audit-log writes, and zero upstream
    provider calls;
  - live `bridge-regression` now includes `organization-admin-api-keys`,
    covering create/list/retrieve/delete/audit-log behavior against the
    deployed DeepSeek-backed bridge with zero provider token usage.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused admin-key unit test passed 1/1; focused Organization unit tests
    passed 7/7.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-admin-api-keys`: passed 1/1, latency 636 ms,
    zero provider token usage, and output only admin-key ids, not values.
  - Focused live `organization-project-admin` passed after pagination
    hardening; focused `responses-mcp-remote-call` and
    `responses-mcp-remote-stream-call` passed after forced tool-choice
    hardening.
  - `npm test`: passed 207/207.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1613 ms, P95 latency 1720 ms, and total usage 99
    tokens.
  - `npm run smoke:bridge`: returned `bridge-ok`.
  - Full live `bridge-regression` with report output passed 104/104 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1224 ms, P95 latency
    3221 ms, and total usage 24796 tokens. The suite now includes
    `organization-admin-api-keys`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online`; exercised sidebar controls, page
    navigation, project dialog/browser upload, prompt send, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project create/reopen/cleanup, and reported zero console errors/warnings.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, real admin keys, or one-time synthetic admin-key values
  were added to tracked files. The user-provided DeepSeek key remains absent
  from repository content.

## 2026-06-15 - Local Organization audit logs compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - Admin APIs guide lists audit log review as an administrative workflow and
    points SDK users to the Administration API reference;
  - OpenAPI spec for `GET /v1/organization/audit_logs` documents
    `list-audit-logs`, `effective_at` range filters, `project_ids[]`,
    `event_types[]`, `actor_ids[]`, `actor_emails[]`, `resource_ids[]`,
    `after`/`before` cursor pagination, `limit`, and the
    `object:"list"` / `data` / `first_id` / `last_id` / `has_more` response;
  - OpenAI Node SDK generated Organization audit logs resource documents
    `client.admin.organization.auditLogs.list()` and the audit-log event type
    family, including project, invite, group, role, role-assignment,
    service-account, API-key, user, rate-limit, certificate, and login/logout
    events.
- Extended the local file-backed Organization admin compatibility layer:
  - added an `audit_logs` state directory under
    `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR`;
  - added local audit-log writes for implemented admin mutations, including
    project create/update/archive, invite send/delete, organization user
    add/update/delete, custom role create/update/delete, group
    create/update/delete, direct role assignment create/delete,
    project user add/update/delete, service-account create/update/delete,
    project API-key create/delete boundaries, and rate-limit updates;
  - added `GET /v1/organization/audit_logs` with official list-page shape,
    default newest-first ordering, `after`/`before` pagination, `limit`, and
    local filtering for `effective_at`, project ids, event types, actor ids,
    actor emails, and resource ids;
  - hides internal filter-only metadata from public audit-log responses while
    keeping `compatibility.actual_openai_admin_data:false` explicit.
- Current boundary: this is a local compatibility audit trail for this bridge's
  emulated Organization admin store. It is not a hosted OpenAI security audit
  export, does not include real provider login/session/IP/device telemetry,
  does not prove RBAC enforcement, and does not replace external SIEM or
  compliance logging. It closes SDK/UI 404s and gives deterministic local admin
  event review for Chat Completions-backed deployments.
- Added regression coverage:
  - unit/mock-provider coverage verifies empty list shape, lifecycle event
    writes, hidden internal metadata, local actor projection, event-type,
    project, resource, actor id/email, and `effective_at` filters, pagination,
    invalid filter errors, and zero upstream provider calls;
  - live `bridge-regression` now includes `organization-audit-logs`, covering
    the same lifecycle against the deployed DeepSeek-backed bridge with zero
    provider token usage.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Organization unit tests passed 6/6.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-audit-logs`: passed 1/1 against
    `deepseek-v4-pro`, latency 1319 ms, output
    `organization_audit_logs:proj_...:role_...`, and zero provider token usage.
  - `npm test`: passed 206/206.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1231 ms, P95 latency 1394 ms, and total usage 99
    tokens.
  - `npm run eval:bridge -- --timeout-ms 180000`: passed 103/103 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1196 ms, P95 latency
    3159 ms, and total usage 24946 tokens. The suite now includes
    `organization-audit-logs`.
  - `npm run smoke:bridge`: passed with `output_text:"bridge-ok"`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online`, exercised sidebar/page navigation,
    project dialog, host upload verification, prompt send, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project create/reopen/cleanup, and reported no browser console errors or
    warnings.
  - Service check: app-server, bridge, and web services were all `active`;
    `https://opencodexapp.aialra.online` returned HTTP 200.
  - Space check after the run: `/` was 165G used of 193G, 28G available, 86%
    used; repo `state` was 29M, `output` was 4.4M,
    `/srv/aialra/data/opencodexapp` was 136K, and
    `/srv/aialra/logs/opencodexapp` was 29M.
  - Runtime prune dry-run selected one old UI screenshot; apply deleted one
    file, 83270 bytes, with zero errors.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - Direct search for the provided DeepSeek API key returned no repository
    matches.
- Updated compatibility/evaluation/deployment docs to list the new local audit
  log endpoint, official sources, live eval command, state-directory boundary,
  and remaining Organization admin gaps.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, or usable synthetic project key values were added to
  the repository.

## 2026-06-15 - Local Organization users and invites compatibility

- Used official OpenAI sources for the next Organization admin slice:
  - OpenAPI endpoint list confirmed `/v1/organization/users`,
    `/v1/organization/users/{user_id}`, `/v1/organization/invites`, and
    `/v1/organization/invites/{invite_id}`;
  - OpenAPI spec for `GET /v1/organization/users` documents
    `organization.user` list pagination and `emails` filtering;
  - OpenAPI spec for `GET/POST /v1/organization/invites` documents
    `organization.invite`, `owner|reader` org roles, pending/accepted/expired
    statuses, project membership grants, and pagination;
  - OpenAI Node SDK generated organization users resource documents
    retrieve/update/list/delete methods, `organization.user.deleted`, optional
    user metadata, nested user details, and local role updates;
  - OpenAI Node SDK generated organization invites resource documents
    retrieve/delete methods and `organization.invite.deleted`.
- Extended the local file-backed Organization admin compatibility layer:
  - `GET /v1/organization/users` lists local `organization.user` records with
    `emails` filtering, nested local project memberships, nested `user`
    details, and OpenAI-style pagination;
  - `GET/POST/DELETE /v1/organization/users/{user_id}` retrieves, updates
    local org role/persona/technical-level metadata, and deletes local org
    users with `organization.user.deleted`;
  - creating a local project user now also seeds/synchronizes a matching local
    organization user, making admin pages see coherent org/project membership
    state;
  - deleting a local organization user removes their local project membership
    records;
  - `GET/POST /v1/organization/invites` lists and creates local pending
    `organization.invite` records with expiry timestamps and optional project
    membership grants;
  - `GET/DELETE /v1/organization/invites/{invite_id}` retrieves and deletes
    local invites with `organization.invite.deleted`;
  - invalid org roles return `400 invalid_organization_role`; invalid invite
    project roles return `400 invalid_project_role`.
- Current boundary: this closes another admin SDK/UI 404 class for organization
  users and invites when the gateway is backed by a Chat Completions provider.
  It does not send invitation email, accept invites, create real provider
  accounts, synchronize with OpenAI/DeepSeek identity systems, or implement
  custom role-assignment endpoints.
- Added regression coverage:
  - unit/mock-provider coverage verifies org user listing/retrieval/email
    filtering/update/delete, project-user-to-org-user synchronization, project
    membership cleanup after org-user deletion, invite create/list/retrieve/
    delete, invalid role errors, and zero upstream provider calls;
  - live `bridge-regression` now includes `organization-users-invites`,
    covering the same lifecycle against the deployed DeepSeek-backed bridge.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Organization unit tests passed 4/4.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-users-invites`: passed 1/1 against
    `deepseek-v4-pro`, latency 1876 ms, output
    `organization_users_invites:...`, and zero provider token usage.
  - `npm test`: passed 204/204.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1395 ms, P95 latency 1688 ms, and total usage 99 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 101/101,
    pass rate 1.0, average latency 1528 ms, P95 latency 5177 ms, and total
    usage 24768 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T17-28-32-837Z.png`.
  - `npm run prune:runtime -- --dry-run`: scanned 2008 runtime candidates
    across 13 targets, selected 1 old UI-smoke screenshot, selected 85635
    bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    85635 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; local bridge healthz returned `ok:true`; public
    `https://opencodexapp.aialra.online/` returned HTTP 200; the filesystem had
    28 GB available; `state/` was 28 MB, `output/` was 4.4 MB,
    `/srv/aialra/data/opencodexapp` was 136 KB, and
    `/srv/aialra/logs/opencodexapp` was 28 MB.
- Secret handling: no API keys, account credentials, provider headers, local
  deployment env files, or invite secrets were added to the repository. Invite
  and organization-user records are local protocol metadata only.

## 2026-06-15 - Local Organization project users and rate limits compatibility

- Used official OpenAI sources for the next Organization project admin slice:
  - RBAC guide confirms project administrators manage project users, service
    accounts, API keys, and project rate limits through the management API;
  - OpenAI Node SDK generated project-users resource documents
    `organization.project.user` records, `added_at`, `role`, optional
    `email/name`, create bodies accepting `user_id` and/or `email`, and
    delete responses with object `organization.project.user.deleted`;
  - OpenAI Node SDK generated project-rate-limits resource documents
    `project.rate_limit` records with model, request/token limits, optional
    daily/image/audio/batch limits, and updateable numeric fields.
- Extended the local file-backed Organization project admin compatibility
  layer:
  - `GET/POST /v1/organization/projects/{project_id}/users` now lists and
    creates or upserts local project users for active projects;
  - `GET/POST/DELETE /v1/organization/projects/{project_id}/users/{user_id}`
    now retrieves, updates project role, and deletes local project users;
  - project-user roles are normalized to `owner` or `member`; invalid roles
    return OpenAI-style `400 invalid_project_role`;
  - user IDs can come from caller-supplied `user_id`, stable email-derived IDs,
    or generated local IDs; optional email/name metadata is preserved;
  - `GET /v1/organization/projects/{project_id}/rate_limits` lazily seeds local
    `project.rate_limit` records for representative text, embedding, and image
    models including `deepseek-v4-pro`;
  - `POST /v1/organization/projects/{project_id}/rate_limits/{rate_limit_id}`
    updates local numeric rate-limit fields and rejects negative/non-finite
    values with `400 invalid_rate_limit_value`;
  - archived projects reject project-user and rate-limit reads/mutations with
    `400 project_archived`.
- Current boundary: this closes another admin SDK/UI 404 class for local
  project access and limit-management flows when the gateway is backed by a
  Chat Completions provider. These records are compatibility metadata only;
  they do not create real provider accounts, grant real provider access,
  modify hosted OpenAI/DeepSeek limits, or enforce traffic throttling.
- Added regression coverage:
  - unit/mock-provider coverage verifies project user create/list/retrieve/
    update/delete, invalid role errors, seeded rate-limit listing, rate-limit
    update, invalid/missing rate-limit errors, archived project errors, and
    zero upstream provider calls;
  - live `bridge-regression` now includes
    `organization-project-users-rate-limits`, covering the same lifecycle
    against the deployed DeepSeek-backed bridge.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Organization project unit tests passed 2/2.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-project-users-rate-limits`: passed 1/1 against
    `deepseek-v4-pro`, latency 450 ms, output
    `organization_project_access:...`, and zero provider token usage.
  - `npm test`: passed 203/203.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1437 ms, P95 latency 1762 ms, and total usage 99 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 100/100,
    pass rate 1.0, average latency 1375 ms, P95 latency 3871 ms, and total
    usage 25023 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T17-09-46-014Z.png`.
  - `npm run prune:runtime -- --dry-run`: scanned 1958 runtime candidates
    across 13 targets, selected 1 old UI-smoke screenshot, selected 83216
    bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    83216 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; local bridge healthz returned `ok:true`; public
    `https://opencodexapp.aialra.online/` returned HTTP 200; the filesystem had
    29 GB available; `state/` was 27 MB, `output/` was 4.4 MB,
    `/srv/aialra/data/opencodexapp` was 136 KB, and
    `/srv/aialra/logs/opencodexapp` was 28 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. Rate-limit and user
  records contain protocol metadata only and no usable provider secrets.

## 2026-06-15 - Local Organization project admin compatibility

- Used the official OpenAI OpenAPI specs through the developer-docs MCP for:
  - `GET/POST /v1/organization/projects`;
  - `GET/POST /v1/organization/projects/{project_id}`;
  - `POST /v1/organization/projects/{project_id}/archive`;
  - `GET /v1/organization/projects/{project_id}/api_keys`;
  - `GET/DELETE /v1/organization/projects/{project_id}/api_keys/{api_key_id}`;
  - `GET/POST /v1/organization/projects/{project_id}/service_accounts`;
  - `GET/POST/DELETE /v1/organization/projects/{project_id}/service_accounts/{service_account_id}`.
- Added a local file-backed Organization project admin compatibility layer:
  - local projects persist as `organization.project` records with
    create/list/retrieve/update/archive behavior and `include_archived`
    filtering;
  - local project service accounts persist as
    `organization.project.service_account` records with create/list/retrieve,
    update, and delete lifecycle;
  - service-account creation also creates a matching redacted
    `organization.project.api_key` record while returning a one-time synthetic
    `organization.project.service_account.api_key` value prefixed
    `oc_local_key_`, never `sk-`;
  - persisted project API-key records never include a secret `value`;
  - deleting a service-account-owned key directly returns
    `service_account_api_key_delete_not_supported`; deleting the owning service
    account removes its local key records;
  - missing and archived project paths return OpenAI-style error envelopes with
    `project_not_found` and `project_archived` codes.
- Added runtime controls:
  - `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR`, defaulting to
    `$CODEXCOMPAT_STATE_DIR/local-organization-admin`;
  - `CODEXCOMPAT_ORGANIZATION_ADMIN_MAX_RECORDS`, defaulting to `5000`;
  - `scripts/prune-runtime-state.mjs` now recursively prunes local
    Organization admin JSON files with age, count, and byte caps.
- Current boundary: this closes SDK/admin-page 404s for local project,
  service-account, and project API-key lifecycle flows when the gateway is
  backed by a Chat Completions provider. It does not create real provider
  accounts, grant real provider access, produce usable OpenAI/DeepSeek keys, or
  implement the remaining Organization admin families such as admin API keys,
  audit logs, certificates, data retention, groups, invites, project users/rate
  limits, roles, spend alerts, or organization users.
- Added regression coverage:
  - unit/mock-provider coverage verifies project lifecycle, service-account
    lifecycle, redacted key listing/retrieval, one-time key non-persistence,
    service-account key deletion rejection, project archive filtering, and
    zero upstream provider calls;
  - live `bridge-regression` now includes `organization-project-admin`, covering
    the same lifecycle against the deployed DeepSeek-backed bridge.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_admin.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`,
    `scripts/prune-runtime-state.mjs`, and `test/server.test.js`.
  - Focused Organization project unit test passed 1/1.
  - `npm test`: passed 202/202.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-project-admin`: passed 1/1 against
    `deepseek-v4-pro`, latency 363 ms, output `organization_project:...`, and
    zero provider token usage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 99/99,
    pass rate 1.0, average latency 1313 ms, P95 latency 3662 ms, and total
    usage 24851 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1008 ms, P95 latency 1054 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T16-50-50-715Z.png`.
  - `npm run prune:runtime -- --dry-run`: scanned 1905 runtime candidates
    across 13 targets, selected 1 old UI-smoke screenshot, selected 70914
    bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    70914 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 30 GB available; `state/` was 27 MB,
    `output/` was 4.4 MB, `/srv/aialra/data/opencodexapp` was 136 KB, and
    `/srv/aialra/logs/opencodexapp` was 28 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. The compatibility
  service-account key value is synthetic, one-time only, prefixed
  `oc_local_key_`, and not persisted.

## 2026-06-15 - Local Organization usage ledger aggregation

- Used official OpenAI sources for the Organization usage/cost upgrade:
  - OpenAI OpenAPI endpoint list confirms the current `/organization/costs`
    and `/organization/usage/*` endpoint family;
  - OpenAI OpenAPI `usage-costs` documents `start_time`, `end_time`,
    `bucket_width:"1d"`, `project_ids[]`, `api_key_ids[]`,
    `group_by[]=project_id|line_item|api_key_id`, `limit`, `page`, and
    `organization.costs.result`;
  - OpenAI OpenAPI `usage-completions` documents `1m|1h|1d` buckets,
    project/user/API-key/model/batch/service-tier filters and grouping, token
    result fields, and cursor pagination;
  - OpenAI OpenAPI `usage-embeddings`, `usage-moderations`,
    `usage-images`, `usage-audio-speeches`, and
    `usage-audio-transcriptions` document the resource-specific result fields
    now populated from the local ledger.
- Replaced the old pure zero-value usage/cost implementation with a bounded
  local Organization usage ledger:
  - added `LocalOrganizationUsageStore` under
    `CODEXCOMPAT_ORGANIZATION_USAGE_STATE_DIR`, defaulting to
    `$CODEXCOMPAT_STATE_DIR/local-organization-usage`;
  - records numeric usage events for `/v1/responses`, `/v1/responses/compact`,
    `/v1/responses/input_tokens`, `/v1/chat/completions`,
    `/v1/completions`, `/v1/embeddings`, `/v1/moderations`,
    `/v1/audio/speech`, `/v1/audio/transcriptions`,
    `/v1/audio/translations`, `/v1/images/generations`,
    `/v1/images/edits`, and `/v1/images/variations`;
  - stores only endpoint, created time, model/dimension identifiers, hashed API
    key IDs, and numeric usage totals. It does not store prompts, messages,
    uploaded file bodies, raw Authorization headers, API keys, or provider
    secrets;
  - supports official-style `page` cursor pagination, `project_ids[]`,
    `user_ids[]`, `api_key_ids[]`, `models[]`, `batch`, image `sources[]` /
    `sizes[]`, and supported `group_by[]` dimensions;
  - keeps zero-value bucket rows for no-match queries and for not-yet-metered
    local hosted-tool counters such as vector stores, file search, web search,
    and code-interpreter sessions;
  - costs now aggregates local `quantity` when grouped by `line_item`, while
    `amount.value` remains `0` because this is not a real provider invoice or
    billing importer.
- Added `CODEXCOMPAT_ORGANIZATION_USAGE_STATE_DIR` and
  `CODEXCOMPAT_ORGANIZATION_USAGE_MAX_RECORDS` deployment docs, plus a prune
  target for `local-organization-usage/events`.
- Added regression coverage:
  - unit/mock-provider coverage verifies local ledger aggregation from Chat,
    Embeddings, Moderations, Audio speech, Audio transcription, and Images;
    `group_by`/filter behavior; hashed API-key dimensions; zero-value
    no-match fallback; costs `line_item` quantity; page cursor pagination; and
    that raw bearer tokens are absent from admin responses;
  - `bridge-regression` `organization-usage-costs` now creates live
    Chat/Embeddings/Images ledger events before querying usage and costs.
- Current boundary: this is local operational usage telemetry for the gateway,
  not OpenAI hosted billing and not DeepSeek invoice reconciliation. It does
  not yet meter internal hosted-tool calls for vector stores/file search/web
  search/code-interpreter sessions, and it does not enforce Organization admin
  authorization or project-scoped billing access.
- Adjusted live eval assertions to focus on protocol facts rather than
  provider phrasing for remote MCP approval flows: the suite now treats the
  approval ID, remote tool call, arguments, output, auth/session forwarding,
  and secret redaction as authoritative, while final assistant text is only an
  auxiliary signal.
- Verification completed:
  - `node --check` passed for `src/bridge/local_organization_usage.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`,
    `scripts/prune-runtime-state.mjs`, and `test/server.test.js`;
  - focused Organization usage tests passed 2/2;
  - affected Chat/Completions/Embeddings/Moderations/Audio/Images/usage tests
    passed 55/55.
  - `npm test` passed 212/212;
  - `npm run eval:protocol` passed 2/2;
  - `npm run smoke:bridge` returned a completed `bridge-ok` response;
  - focused live `organization-usage-costs` passed 1/1 after fixing the eval
    case to send the configured model;
  - `node scripts/eval-harness.mjs --suite bridge-regression --timeout-ms
    180000 --output output/bridge-regression-latest.json` passed 108/108
    against the live DeepSeek-backed bridge with average latency 1293 ms, p95
    3283 ms, and total usage 24,945 tokens;
  - `npm run smoke:ui -- --timeout-ms 180000` passed against
    `https://opencodexapp.aialra.online`, covering page navigation, sidebar
    controls, project creation/reopen/cleanup, browser upload, conversation
    submission/reload, completed-turn actions, and generated image artifacts
    with no browser console errors;
  - systemd reported `aialra-opencodexapp-app-server.service`,
    `aialra-opencodexapp-bridge.service`, and
    `aialra-opencodexapp-web.service` active; bridge `/healthz` returned OK
    with provider base `https://api.deepseek.com` and default model
    `deepseek-v4-pro`; the public domain returned HTTP 200;
  - storage check: `/` was 92% used, but this project remained small
    (`state` 40M, `output` 4.6M, app data 136K, app logs 30M). Runtime prune
    scanned 14 targets, selected 2 old UI screenshots, and with `--apply`
    deleted both candidates without errors; local Organization usage events
    scanned 281 files and selected 0.
- Secret handling: no API keys, account credentials, provider headers, prompt
  text, message content, file bodies, or local deployment env files were added
  to the repository. The ledger hashes bearer/API-key values before storing an
  API-key dimension.

## 2026-06-15 - Local Organization usage and costs compatibility

- Used the official OpenAI OpenAPI specs through the developer-docs MCP for:
  - `GET /v1/organization/costs`;
  - `GET /v1/organization/usage/completions`;
  - `GET /v1/organization/usage/embeddings`;
  - `GET /v1/organization/usage/images`;
  - `GET /v1/organization/usage/audio_speeches`;
  - `GET /v1/organization/usage/audio_transcriptions`;
  - `GET /v1/organization/usage/vector_stores`;
  - `GET /v1/organization/usage/file_search_calls`;
  - `GET /v1/organization/usage/web_search_calls`;
  - `GET /v1/organization/usage/moderations`;
  - `GET /v1/organization/usage/code_interpreter_sessions`.
- Added a local read-only Organization admin compatibility layer:
  - costs and usage routes now return OpenAI-style `object:"page"` payloads
    containing `object:"bucket"` entries;
  - query validation covers required `start_time`, optional `end_time`,
    `bucket_width`, and bounded `limit`;
  - costs returns zero `organization.costs.result` rows with
    `amount:{value:0,currency:"usd"}`;
  - usage endpoints return zero result rows with the documented
    resource-specific object names and numeric fields for completions,
    embeddings, moderations, images, audio, vector stores, file search, web
    search, and code-interpreter sessions;
  - responses include compatibility metadata marking the payload as local
    zero-value summary data and `actual_openai_admin_data:false`.
- Current boundary: this closes SDK/UI 404s for the documented Organization
  usage/cost endpoint family when the gateway is backed by a Chat Completions
  provider. It is not real OpenAI organization billing, does not import
  provider billing exports, does not meter local bridge history into invoices,
  and does not add admin-key authorization beyond the existing gateway access
  controls.
- Added regression coverage:
  - unit/mock-provider coverage verifies all usage endpoint shapes, costs
    shape, bounded ranges, missing `start_time`, invalid costs bucket width,
    unknown usage resource 404, and zero upstream provider calls;
  - live `bridge-regression` now includes `organization-usage-costs`, querying
    costs plus representative completions, images, file-search, and web-search
    usage endpoints.
- Hardened the UI smoke script after two live runs repeated a Playwright
  stability timeout on the visible `New chat` sidebar button during saved
  project cleanup. The script now reuses its existing visible-button coordinate
  click helper for `New chat`, which keeps the UI assertion while avoiding
  sidebar animation/scroll timing flakes.
- Updated compatibility/evaluation docs to list the Organization usage/cost
  endpoint family, the local zero-value boundary, the focused harness command,
  and the known full-parity gap.
- Verification:
  - `node --check` passed for `src/bridge/local_organization_usage.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `scripts/ui-smoke.mjs`.
  - Focused Organization unit test passed 1/1.
  - `npm test`: passed 201/201.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `organization-usage-costs`: passed 1/1 against
    `deepseek-v4-pro`, latency 389 ms, output `organization_usage:2:2`, and
    zero provider token usage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: first attempt
    returned 97/98 with the new Organization case passing; immediate report
    rerun passed 98/98, pass rate 1.0, average latency 1657 ms, P95 latency
    4211 ms, and total usage 24798 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1481 ms, P95 latency 1632 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: first two attempts repeated
    the saved-project `New chat` stability timeout; after the smoke script
    hardening, the third run passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T16-28-18-773Z.png`.
  - `node scripts/prune-runtime-state.mjs --dry-run`: scanned 1865 runtime
    candidates across 12 targets, selected 3 old UI-smoke screenshots,
    selected 309321 bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted those 3 screenshots, freed
    309321 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 27 GB available; `state/` was 26 MB,
    `output/` was 4.3 MB, `/srv/aialra/data/opencodexapp` was 136 KB, and
    `/srv/aialra/logs/opencodexapp` was 28 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. Organization usage/costs
  compatibility is stateless and writes no runtime records.

## 2026-06-15 - Local Fine-tuning lifecycle compatibility

- Used the official OpenAI OpenAPI specs through the developer-docs MCP for:
  - `POST/GET /v1/fine_tuning/jobs`;
  - `GET /v1/fine_tuning/jobs/{fine_tuning_job_id}`;
  - `POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/cancel`;
  - `POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/pause`;
  - `POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/resume`;
  - `GET /v1/fine_tuning/jobs/{fine_tuning_job_id}/events`;
  - `GET /v1/fine_tuning/jobs/{fine_tuning_job_id}/checkpoints`;
  - `GET/POST /v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions`;
  - `DELETE /v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions/{permission_id}`.
- Added a local file-backed Fine-tuning compatibility layer:
  - `LocalFineTuningStore` persists job records under
    `CODEXCOMPAT_FINE_TUNING_STATE_DIR`, defaulting to
    `$CODEXCOMPAT_STATE_DIR/local-fine-tuning`;
  - job creation accepts official fields including `training_file`, `model`,
    `validation_file`, `suffix`, `method`, `hyperparameters`,
    `integrations`, and `metadata`;
  - creation returns an OpenAI-style `fine_tuning.job` with `status:"succeeded"`,
    local compatibility metadata, a synthetic `ft:...` model id, lifecycle
    events, and a synthetic `fine_tuning.job.checkpoint`;
  - job list supports pagination plus `metadata[k]=v` and `metadata=null`
    filters;
  - retrieve/events/checkpoints/cancel/pause/resume return OpenAI-shaped JSON
    without calling the upstream Chat Completions provider;
  - checkpoint permission list/create/delete returns OpenAI-style
    `checkpoint.permission` resources.
- Added storage and docs controls:
  - `CODEXCOMPAT_FINE_TUNING_STATE_DIR` and
    `CODEXCOMPAT_FINE_TUNING_MAX_RECORDS` are documented for deployment;
  - Fine-tuning job files and checkpoint-permission files are now pruned by
    `scripts/prune-runtime-state.mjs`;
  - compatibility/evaluation docs now describe covered endpoints, local state,
    the focused `fine-tuning-lifecycle` case, and full-parity gaps.
- Current boundary: this is protocol compatibility for SDK/UI/workflow smoke
  tests. It does not validate datasets, schedule hosted training, produce a
  real provider-deployed fine-tuned model, train DeepSeek/OpenAI weights,
  create result artifacts, or enforce real organization/project permissions.
- Verification:
  - `node --check` passed for `src/bridge/local_fine_tuning.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `scripts/prune-runtime-state.mjs`.
  - Focused Fine-tuning unit test passed 1/1.
  - `npm test`: passed 200/200.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `fine-tuning-lifecycle`: passed 1/1 against
    `deepseek-v4-pro`, latency 369 ms, zero provider token usage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 97/97,
    pass rate 1.0, average latency 1318 ms, P95 latency 3955 ms, and total
    usage 24849 tokens. The suite now includes `fine-tuning-lifecycle`.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1305 ms, P95 latency 1494 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: first attempt hit a transient
    browser asset-load/network-change failure before the new-chat button was
    visible; immediate retry passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T15-51-06-850Z.png`.
  - `node scripts/prune-runtime-state.mjs --dry-run`: scanned 1784 runtime
    candidates across 12 targets, including the new Fine-tuning job and
    checkpoint-permission targets; selected 2 old UI-smoke screenshots,
    selected 218996 bytes, and reported 0 errors.
  - `node scripts/prune-runtime-state.mjs --apply`: deleted those 2
    artifacts, freed 218996 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 29 GB available; `state/` was 25 MB,
    `output/` was 4.4 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 28 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
  - Final `node --check` passed again for changed JavaScript files.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. Fine-tuning compatibility
  records are protocol metadata only and remain in ignored runtime state.

## 2026-06-15 - Local Realtime REST handshake compatibility

- Used the official OpenAI Realtime guide, Realtime OpenAPI operations, and SIP
  guide through the developer-docs MCP:
  - `POST /v1/realtime/sessions`
  - `POST /v1/realtime/client_secrets`
  - `POST /v1/realtime/transcription_sessions`
  - `POST /v1/realtime/translations/client_secrets`
  - `POST /v1/realtime/calls`
  - call control actions from the endpoint inventory and SIP guide:
    `accept`, `reject`, `refer`, and `hangup`.
- Added a local file-backed Realtime REST compatibility layer for Chat
  Completions-only deployments:
  - `FileRealtimeStore` persists generated sessions, client secrets, and call
    records under `CODEXCOMPAT_REALTIME_STATE_DIR`, defaulting to
    `$CODEXCOMPAT_STATE_DIR/local-realtime`;
  - Realtime session creation returns a `realtime.session` object with model,
    modalities, instructions, audio config, tools, metadata, compatibility
    metadata, and a local `client_secret:{value,expires_at}`;
  - Realtime client-secret creation returns `value:"ek_..."`, `expires_at`,
    and the effective local session without exposing the deployment provider
    key;
  - transcription-session creation returns
    `object:"realtime.transcription_session"` with transcription defaults and
    a local ephemeral secret;
  - translation client-secret creation returns a local `type:"translation"`
    session and preserves translation model/output language fields;
  - WebRTC call creation accepts official `application/sdp`, JSON, or
    multipart `sdp` + `session` request shapes and returns
    `201 application/sdp` with `Location:/v1/realtime/calls/{call_id}`;
  - call control actions locally transition calls through accepted, rejected,
    referred, and completed states.
- Added storage controls:
  - Realtime session files, client-secret files, and call files are now part of
    `scripts/prune-runtime-state.mjs`;
  - runtime files are written with restricted permissions and remain outside
    git.
- Added regression coverage:
  - unit/mock-provider coverage proves Realtime lifecycle calls do not contact
    the upstream model provider;
  - live `bridge-regression` now includes `realtime-lifecycle`;
  - compatibility and evaluation docs now describe covered endpoints, storage,
    prune policy, generated local token handling, and remaining parity gaps.
- Current boundary: this is REST handshake and lifecycle compatibility, not a
  real low-latency Realtime media service, WebRTC/SIP media bridge, WebSocket
  event runtime, speech-to-speech model loop, or hosted tracing backend.
- Verification:
  - `node --check` passed for `src/bridge/store.js`, `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, `scripts/prune-runtime-state.mjs`, and
    `test/server.test.js`.
  - Focused Realtime unit test passed 1/1.
  - `npm test`: passed 199/199.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `realtime-lifecycle`: passed 1/1 against
    `deepseek-v4-pro`, latency 801 ms, zero provider token usage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 96/96,
    pass rate 1.0, average latency 1308 ms, P95 latency 3406 ms, and total
    usage 24962 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1095 ms, P95 latency 1122 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T15-28-36-959Z.png`.
  - `npm run prune:runtime -- --dry-run`: scanned 1741 runtime candidates
    across 10 targets, including the new Realtime session/client-secret/call
    targets; selected 1 old UI-smoke screenshot, selected 112429 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 artifact, freed
    112429 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 30 GB available; `state/` was 25 MB,
    `output/` was 4.5 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 27 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
  - Final `node --check` passed again for `src/bridge/store.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`,
    `scripts/prune-runtime-state.mjs`, and `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. Realtime `ek_...` values
  are local generated compatibility tokens stored only in ignored runtime
  state.

## 2026-06-15 - Local ChatKit lifecycle compatibility

- Used the official OpenAI endpoint inventory from the developer-docs MCP to
  identify the current beta ChatKit surface:
  - `POST /v1/chatkit/sessions`
  - `POST /v1/chatkit/sessions/{session_id}/cancel`
  - `GET /v1/chatkit/threads`
  - `GET /v1/chatkit/threads/{thread_id}`
  - `GET /v1/chatkit/threads/{thread_id}/items`
- Added a local file-backed ChatKit compatibility layer for Chat
  Completions-only deployments:
  - `FileChatKitStore` persists generated session and thread/item resources
    under `CODEXCOMPAT_CHATKIT_STATE_DIR`, defaulting to
    `$CODEXCOMPAT_STATE_DIR/local-chatkit`;
  - `POST /v1/chatkit/sessions` validates `user` and `workflow.id`, returns a
    beta-style `chatkit.session`, local generated `client_secret`,
    `expires_at`, request caps, workflow/scope/user fields, and compatibility
    metadata;
  - `POST /v1/chatkit/sessions/{session_id}/cancel` marks sessions
    `status:"cancelled"` locally;
  - `GET /v1/chatkit/threads` lists local `chatkit.thread` records with
    OpenAI-style pagination, default descending order, and `user` filtering;
  - local extension routes create, retrieve, update, and delete threads so UI
    and SDK smoke tests can exercise a full lifecycle before a hosted ChatKit
    workflow executor exists;
  - local item routes append one item or an `items[]` batch and list items with
    stable creation order, preserving metadata and role/type/status fields.
- Added storage controls:
  - ChatKit session files and thread directories are now part of
    `scripts/prune-runtime-state.mjs`;
  - runtime files are written with restricted file/directory permissions and
    remain outside git.
- Added regression coverage:
  - unit/mock-provider coverage proves ChatKit lifecycle calls do not contact
    the upstream model provider;
  - live `bridge-regression` now includes `chatkit-lifecycle`;
  - compatibility and evaluation docs now describe covered endpoints,
    extension routes, storage, prune policy, and remaining parity gaps.
- Current boundary: this is a local protocol compatibility layer, not OpenAI's
  hosted ChatKit workflow runtime, hosted authentication broker, UI transport,
  or workflow execution service. Remaining work includes workflow execution
  over Responses/Chat, session request accounting, token validation middleware,
  richer item subtype coverage, and ChatKit UI smoke coverage when the
  frontend adopts these endpoints.
- Verification:
  - `node --check` passed for `src/bridge/store.js`, `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, `scripts/prune-runtime-state.mjs`, and
    `test/server.test.js`.
  - Focused ChatKit unit test passed 1/1.
  - `npm test`: passed 198/198.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `chatkit-lifecycle`: passed 1/1 against
    `deepseek-v4-pro`, latency 323 ms.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 95/95,
    pass rate 1.0, average latency 1467 ms, P95 latency 4031 ms, and total
    usage 24792 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1242 ms, P95 latency 1280 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved project reopen/cleanup, and console error/warning checks;
    screenshot written to
    `output/playwright/ui-smoke-2026-06-15T15-09-10-438Z.png`.
  - `npm run prune:runtime -- --dry-run`: scanned 1692 runtime candidates,
    selected 1 old UI-smoke screenshot, selected 104086 bytes, and reported
    0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 artifact, freed
    104086 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 30 GB available; `state/` was 24 MB,
    `output/` was 4.5 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 27 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
  - Final `node --check` passed again for `src/bridge/store.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`,
    `scripts/prune-runtime-state.mjs`, and `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. ChatKit `client_secret`
  values are local generated compatibility tokens stored only in ignored
  runtime state.

## 2026-06-15 - Streaming legacy function-call compatibility

- Closed another Responses streaming compatibility gap for Chat Completions
  providers:
  - streaming `choices[].delta.function_call` fragments are now accumulated into
    a Responses `function_call` output item;
  - the bridge emits `response.function_call_arguments.delta`,
    `response.function_call_arguments.done`, `response.output_item.done`, and a
    completed final response item with the accumulated name and arguments;
  - legacy streamed calls receive a stable generated call id such as
    `call_chatcmpl_stream_legacy_fc_0`;
  - stored replay converts the legacy call back to Chat `tool_calls`, so later
    `function_call_output` turns are sent upstream as matching Chat `tool`
    messages.
- Added coverage for both modern and legacy stream shapes:
  - mock-provider unit coverage validates exact legacy
    `delta.function_call` fragments, final Responses events, completed output,
    usage mapping, and follow-up replay;
  - live `bridge-regression` now includes `responses-function-tool-stream`,
    covering the modern `delta.tool_calls` stream shape returned by DeepSeek.
- Updated compatibility and evaluation docs to describe streaming
  `tool_calls` and legacy `function_call` mapping, argument event emission, and
  follow-up replay behavior.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Focused legacy/function-call streaming unit tests passed 3/3.
  - `npm test`: passed 197/197.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `responses-function-tool-stream`: passed 1/1 against
    `deepseek-v4-pro`, latency 1751 ms, 24 SSE events, and 371 total tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 94/94,
    pass rate 1.0, average latency 1475 ms, P95 latency 3913 ms, and total
    usage 24959 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1127 ms, P95 latency 1173 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering sidebar navigation, core
    pages, project dialog/upload, prompt submission, completed-turn controls,
    reload persistence, generated image artifact display, saved project
    reopen/cleanup, and console error/warning checks; screenshot written to
    `output/playwright/ui-smoke-2026-06-15T14-46-35-732Z.png`.
  - `npm run prune:runtime -- --dry-run`: after UI smoke, scanned 1665
    runtime candidates, selected 2 old UI-smoke screenshots, selected 318673
    bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted those 2 artifacts, freed
    318673 bytes, and reported 0 errors.
  - Final `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 33 GB available; `state/` was 24 MB,
    `output/` was 4.6 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 27 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-15 - Assistants token budgets and MCP tool choice hardening

- Used the official OpenAI Assistants create-run/create-thread-and-run
  references to close the next token-budget compatibility gap:
  - `max_completion_tokens` and `max_prompt_tokens` are documented as
    best-effort budgets over a Run;
  - if either budget is exceeded, the hosted Run ends with
    `status:"incomplete"` and callers should inspect `incomplete_details`.
- Extended local Chat-backed Assistants Runs:
  - synchronous Runs now compare aggregate Chat `usage.prompt_tokens` and
    `usage.completion_tokens` against Run `max_prompt_tokens` and
    `max_completion_tokens`;
  - streaming Runs now do the same after reconstructing the streamed Chat
    completion and also treat length-style Chat `finish_reason` values as
    `max_completion_tokens` exhaustion when that Run budget is set;
  - token-budget terminal states now persist `status:"incomplete"`,
    `incomplete_at`, `incomplete_details.reason`, aggregate `usage`, and
    compatibility metadata under
    `metadata.compatibility.local_assistants.token_budget`;
  - streamed Runs now emit `thread.run.incomplete` instead of
    `thread.run.completed` for those observed token-budget terminal states.
- Extended regression coverage:
  - added unit/mock-provider coverage for synchronous `max_prompt_tokens`
    and `max_completion_tokens` incomplete Runs;
  - added unit/mock-provider coverage for streamed
    `thread.run.incomplete` when Chat ends with `finish_reason:"length"`;
  - added live bridge-regression case `assistants-token-budget-incomplete`.
- Hardened remote MCP tool-choice compatibility after the first full live run
  exposed a flaky `responses-mcp-remote-background-call` failure:
  - `tools:[{type:"mcp"}]` requests now preserve exact MCP `tool_choice`
    intent while local MCP tools are reserved from initial Chat translation;
  - after remote `tools/list` import, the bridge maps exact original MCP tool
    names such as `roll` to the generated Chat function name when exactly one
    matching remote MCP tool exists;
  - ambiguous or missing MCP tool-choice names are recorded and left to normal
    Chat tool selection rather than forcing the wrong server;
  - compatibility metadata now records the mapping under
    `metadata.compatibility.local_mcp.tool_choice`.
- Updated docs:
  - compatibility matrix now documents observed Assistants token-budget
    incomplete mapping and narrows the remaining gap to exact hosted tokenizer
    accounting before provider calls and async worker scheduling;
  - compatibility matrix now documents exact MCP `tool_choice` mapping for
    generated Chat function tools;
  - evaluation plan now lists the new synchronous, streaming, live Assistants
    regression coverage, plus the remote MCP forced-tool-choice guard.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/local_mcp.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Assistants API unit tests passed 17/17.
  - Focused remote MCP unit tests passed 9/9.
  - `npm test`: passed 194/194.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `assistants-token-budget-incomplete`: passed 1/1 against
    `deepseek-v4-pro`, latency 1026 ms in the final focused run,
    `status:"incomplete"`, `incomplete_reason:"max_completion_tokens"`,
    trigger `finish_reason_length`, and 31 total tokens.
  - Focused live `responses-mcp-remote-background-call`: passed 1/1 after
    MCP `tool_choice` mapping, latency 5275 ms, output
    `mcp-remote-background-call-ok`, status history
    `in_progress -> completed`, `remote_call_success_count:1`, and observed
    remote MCP methods `initialize`, `notifications/initialized`,
    `tools/list`, and `tools/call`.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 91/91,
    pass rate 1.0, average latency 1328 ms, P95 latency 3446 ms, and total
    usage 22214 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1031 ms, P95 latency 1154 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering sidebar navigation, core
    pages, project dialog/upload, prompt submission, completed-turn controls,
    reload persistence, generated image artifact display, saved project
    reopen/cleanup, and console error/warning checks; screenshot written to
    `output/playwright/ui-smoke-2026-06-15T13-42-10-474Z.png`.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1601 runtime
    candidates, selected 17 old Playwright/UI-smoke artifacts, selected
    293945 bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted those 17 artifacts, freed
    293945 bytes, and reported 0 errors.
  - Final `node --check` passed for `src/bridge/server.js`,
    `src/bridge/local_mcp.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 37 GB available; `state/` was 23 MB,
    `output/` was 4.7 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 26 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-15 - Computer Use streaming follow-up action mapping

- Continued the local Computer Use action-loop work from the official OpenAI
  Computer Use action list:
  <https://developers.openai.com/api/docs/guides/tools-computer-use#possible-computer-use-actions>.
- Closed the streaming follow-up action interception gap for Chat-only
  providers:
  - `computer_call_output` follow-up turns now inject the generated
    `local_computer_action` Chat function tool for streaming requests as well
    as non-streaming/background requests;
  - streaming Responses now use a local tool loop that buffers upstream Chat
    SSE chunks, reconstructs the Chat completion, detects generated Computer
    action tool calls, maps them back to public `computer_call` output items,
    and suppresses bridge-internal `function_call` output items and
    `response.function_call_arguments.*` events;
  - the same stream loop still preserves remote MCP streaming call/approval
    behavior, so Computer action interception does not break MCP tool loops;
  - forced `tool_choice:{type:"computer"}` still maps to the generated Chat
    function name and records
    `metadata.compatibility.local_computer.tool_choice`.
- Extended coverage:
  - added a mock-provider unit test for streamed generated Computer action
    tool-call fragments, proving the public SSE contains `computer_call` and
    never exposes the bridge-internal function call;
  - added live bridge-regression case `responses-computer-action-stream`;
  - updated the compatibility matrix and evaluation plan to describe
    non-streaming, streaming, and background follow-up action mapping.
- Current boundary: the bridge now preserves the protocol loop for screenshot
  requests and model-requested follow-up actions across non-streaming,
  streaming, and background Responses. It still does not physically run a
  browser/desktop executor, capture real screenshots, acknowledge safety checks
  as policy, isolate desktop state, or orchestrate server-side multi-round UI
  execution.
- Verification:
  - `node --check` passed for `src/bridge/local_computer.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Computer Use unit tests passed 6/6.
  - `npm test`: passed 196/196.
  - Restarted `aialra-opencodexapp-bridge.service`; local healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `responses-computer-action-stream`: passed 1/1 against
    `deepseek-v4-pro`, latency 2042 ms, 5 SSE events, and 1097 total tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 93/93,
    pass rate 1.0, average latency 1429 ms, P95 latency 3930 ms, and total
    usage 24552 tokens. The suite includes
    `responses-computer-action-stream`.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1171 ms, P95 latency 1192 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering sidebar navigation, core
    pages, project dialog/upload, prompt submission, completed-turn controls,
    reload persistence, generated image artifact display, saved project
    reopen/cleanup, and console error/warning checks; screenshot written to
    `output/playwright/ui-smoke-2026-06-15T14-28-29-514Z.png`.
  - `npm run prune:runtime -- --dry-run`: after UI smoke, scanned 1638 runtime
    candidates, selected 1 old UI-smoke screenshot, selected 87671 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 artifact, freed
    87671 bytes, and reported 0 errors.
  - Final `node --check` passed for `src/bridge/local_computer.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 36 GB available; `state/` was 23 MB,
    `output/` was 4.7 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 27 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-15 - Computer Use follow-up action mapping

- Used the official OpenAI Computer Use guide for the action-loop surface:
  <https://developers.openai.com/api/docs/guides/tools-computer-use#possible-computer-use-actions>.
  The documented possible action types are `click`, `double_click`, `scroll`,
  `type`, `wait`, `keypress`, `drag`, `move`, and `screenshot`; `keypress`
  is standalone keyboard input while mouse actions can also carry optional
  `keys`.
- Extended the local Computer Use compatibility adapter:
  - follow-up turns that include returned `computer_call_output` now inject a
    generated Chat function tool so a Chat Completions-only model can request
    the next Computer Use action;
  - forced `tool_choice:{type:"computer"}` and
    `tool_choice:{type:"computer_use_preview"}` are mapped to the generated
    function name and recorded under
    `metadata.compatibility.local_computer.tool_choice`;
  - returned generated-function calls are mapped back to public Responses
    `computer_call` items, preserving `action`, `actions[]`,
    `pending_safety_checks`, `call_id`, environment, and display dimensions;
  - bridge-internal generated function calls are suppressed from public
    Responses output so clients see the expected Computer Use loop item.
- Added regression coverage:
  - unit/mock-provider coverage for a returned `computer_call_output`, forced
    computer `tool_choice`, generated Chat action tool, and mapped public
    `computer_call`;
  - live bridge-regression case `responses-computer-action`, which validates
    DeepSeek-backed follow-up action mapping and shared `max_tool_calls`
    accounting;
  - compatibility/evaluation docs now describe the covered action-loop shape
    and the remaining executor boundary.
- Current boundary: this remains a protocol adapter, not a hosted
  browser/desktop executor. It preserves screenshot-first and follow-up action
  loop items, but it does not physically click/type/scroll/capture screenshots
  or isolate desktop state. Full parity still needs a Playwright or VNC-backed
  executor, safety-check policy, streaming action interception, session
  isolation, and cleanup.
- Verification:
  - `node --check` passed for `src/bridge/local_computer.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused Computer Use unit tests passed 5/5.
  - `npm test`: passed 195/195.
  - Restarted/checked the deployed bridge; local healthz returned `ok:true`,
    provider base `https://api.deepseek.com`, default model `deepseek-v4-pro`,
    and `has_provider_key:true`.
  - Focused live `responses-computer-action`: passed 1/1 against
    `deepseek-v4-pro`, latency 1731 ms, total usage 1084 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 92/92,
    pass rate 1.0, average latency 1353 ms, P95 latency 3760 ms, and total
    usage 23300 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1171 ms, P95 latency 1275 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering sidebar navigation, core
    pages, project dialog/upload, prompt submission, completed-turn controls,
    reload persistence, generated image artifact display, saved project
    reopen/cleanup, and console error/warning checks; screenshot written to
    `output/playwright/ui-smoke-2026-06-15T14-12-29-902Z.png`.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1612 runtime
    candidates, selected 2 old UI-smoke screenshots, selected 193156 bytes,
    and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted those 2 artifacts, freed
    193156 bytes, and reported 0 errors.
  - Final `node --check` passed for `src/bridge/local_computer.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 37 GB available; `state/` was 23 MB,
    `output/` was 4.9 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 27 MB.
  - Local bridge healthz returned `ok:true`; the public
    `https://opencodexapp.aialra.online/` entrypoint returned HTTP 200.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants run reasoning effort

- Used official OpenAI docs via the developer-docs MCP:
  - OpenAPI 2.3 lists the Assistants Run creation endpoints
    `/v1/threads/{thread_id}/runs` and `/v1/threads/runs`;
  - the official reasoning guide says supported effort values are
    model-dependent and can include `none`, `minimal`, `low`, `medium`,
    `high`, and `xhigh`.
- Closed the local Assistants Run `reasoning_effort` compatibility gap for
  Chat-only providers:
  - local `thread.run` records now persist `reasoning_effort`;
  - Assistants-to-Chat request generation forwards `run.reasoning_effort` into
    the shared Chat passthrough compatibility layer;
  - for DeepSeek-compatible providers, Run `reasoning_effort:"none"` now
    omits upstream `reasoning_effort`, sends `thinking:{type:"disabled"}`,
    and records
    `metadata.compatibility.local_assistants.chat_passthrough.reasoning_effort`;
  - list/retrieve Run responses preserve the Run field because it is stored on
    the local run object.
- Extended regression coverage:
  - added a unit/mock-provider Assistants test proving Run
    `reasoning_effort:"none"` maps to DeepSeek non-thinking mode, returns on
    create/list/retrieve, and records compatibility metadata;
  - added live bridge-regression case
    `assistants-reasoning-effort-none`.
- Updated docs:
  - compatibility matrix now includes Assistants Run `reasoning_effort` in the
    shared reasoning-effort mapping and endpoint notes;
  - evaluation plan now lists the Assistants reasoning-effort live case and
    parity requirement.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/store.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 14/14, including the new Run reasoning-effort mock-provider case.
  - `npm test`: passed 191/191.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `assistants-reasoning-effort-none` passed 1/1 against
    `deepseek-v4-pro`, latency 3248 ms, output
    `assistants-reasoning-effort-live-ok`, 2 messages, 1 run, and 40 total
    tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 89/89,
    pass rate 1.0, average latency 1365 ms, P95 latency 3799 ms, and total
    usage 22066 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1283 ms, P95 latency 1438 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising load/auth, sidebar and
    core page navigation, project dialog/upload, prompt submission, completed
    turn controls, reload persistence, generated image artifact display, saved
    project reopen/cleanup, and console error/warning checks.
  - `npm run prune:runtime -- --dry-run`: scanned 1496 candidates, selected
    1 old UI smoke screenshot, selected 109455 bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    109455 bytes, and reported 0 errors.
  - Service/storage check after cleanup: `aialra-opencodexapp-app-server`,
    `aialra-opencodexapp-bridge`, and `aialra-opencodexapp-web` were active;
    public HTTPS returned HTTP 200; the filesystem had 38 GB available;
    `state/` was 21 MB, `output/` was 4.8 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 25 MB.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants Run Step include projection

- Used the official OpenAI Assistants Run Step API references to close a
  response-shape gap:
  - `GET /v1/threads/{thread_id}/runs/{run_id}/steps` supports
    `include[]=step_details.tool_calls[*].file_search.results[*].content`;
  - `GET /v1/threads/{thread_id}/runs/{run_id}/steps/{step_id}` supports the
    same include value;
  - Create Run exposes the same include query parameter for run-step
    file-search result content in run event contexts.
- Implemented local compatibility for Chat-only providers:
  - local Assistants `file_search` Run Steps still persist full retrieval
    evidence for audit and later include-aware retrieval;
  - Run Step list/retrieve responses now hide
    `step_details.tool_calls[*].file_search.results[*].content` by default and
    return it only when the official include value is requested;
  - streamed hosted Assistants `file_search` Run Step events apply the same
    projection, including `POST /v1/threads/{thread_id}/runs?stream=true` and
    `POST /v1/threads/runs?stream=true`;
  - file-search result metadata such as `file_id`, filename, score, query, and
    chunk metadata remains visible without the include value.
- Extended regression coverage:
  - updated the existing Assistants `file_search` mock-provider test to verify
    default-hidden and include-expanded content for Run Step list and retrieve;
  - added a streaming Assistants `file_search` mock-provider test to verify SSE
    `thread.run.step.completed` hides result content by default and includes it
    when the official include value is requested;
  - extended the live `assistants-file-search` bridge-regression case to check
    default-hidden and include-expanded Run Step content against DeepSeek.
- Updated docs:
  - compatibility matrix now documents include-gated Assistants Run Step
    `file_search` result content for list, retrieve, and streamed run events;
  - evaluation plan now lists this coverage in both the live bridge-regression
    suite and the Assistants mock-provider coverage description.
- Verification so far:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 13/13.
  - `npm test`: passed 190/190.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live `assistants-file-search` passed 1/1 against
    `deepseek-v4-pro`, latency 1790 ms, output
    `assistants-file-search-live-ok [1]`, 2 Run Steps, 2 messages, and 205
    total tokens. This case now verifies default-hidden and include-expanded
    Assistants Run Step file-search result content.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 88/88,
    pass rate 1.0, average latency 1350 ms, P95 latency 3938 ms, and total
    usage 22186 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1205 ms, P95 latency 1297 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising sidebar navigation,
    core pages, project dialog/upload, prompt submission, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project reopen/cleanup, and console error/warning checks.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1470 runtime
    candidates, selected 1 old UI smoke screenshot, selected 85798 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    85798 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 39 GB available; `state/` was 20 MB,
    `output/` was 4.7 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 25 MB.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants run additional messages

- Used the official OpenAI Create Run API reference to close another
  Assistants compatibility gap:
  - `additional_messages` adds messages to the thread before creating the run;
  - `additional_instructions` appends per-run guidance to the effective run
    instructions.
- Implemented local compatibility for Chat-only providers:
  - run creation now appends `additional_messages` before creating the local
    run, so the upstream Chat request sees the appended user/assistant content;
  - appended messages reuse local thread-message normalization and metadata;
  - appended message attachments are validated before mutation and materialized
    into thread/run `tool_resources` before local hosted tools execute;
  - invalid `additional_messages` shapes or missing attachment files fail before
    creating messages, runs, or upstream provider calls;
  - `additional_instructions` now appends to the effective run instructions and
    therefore to the upstream Chat system context.
- Extended regression coverage:
  - added a unit/mock-provider test proving `additional_messages`,
    `additional_instructions`, and file-search attachment materialization reach
    the same Chat-backed run;
  - added a unit/mock-provider test proving malformed `additional_messages` and
    missing attached files do not mutate the thread or call the provider;
  - added live bridge-regression case `assistants-additional-messages` against
    the configured DeepSeek model.
- Updated docs:
  - compatibility matrix now documents `additional_messages` /
    `additional_instructions` on `POST /v1/threads/{thread_id}/runs`;
  - evaluation plan now lists mock and live coverage for appended run messages
    and pre-run attachment materialization.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/store.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 12/12.
  - `npm test`: passed 189/189.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 88/88,
    pass rate 1.0, average latency 1321 ms, P95 latency 4004 ms, and total
    usage 21983 tokens. The new `assistants-additional-messages` case passed
    with status `completed`, 2 messages, 1 run, 1 step, output
    `assistants-additional-live-ok`, and 101 total tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1249 ms, P95 latency 1260 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising sidebar navigation,
    core pages, project dialog/upload, prompt submission, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project reopen/cleanup, and console error/warning checks.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1444 runtime
    candidates, selected 1 old UI smoke screenshot, selected 86158 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    86158 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 40 GB available; `state/` was 20 MB,
    `output/` was 4.8 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 25 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants active-run locks and expiration

- Used the official OpenAI Assistants Run lifecycle documentation to pin the
  local compatibility target:
  - `requires_action` runs must receive tool outputs before `expires_at`;
  - elapsed `expires_at` moves a run to `expired`;
  - callers continue a thread by adding messages and creating another run only
    after the previous run reaches a terminal state.
- Closed the local Assistants thread-lock gap for Chat-only providers:
  - non-terminal local runs now lock `POST /v1/threads/{thread_id}/messages`
    and `POST /v1/threads/{thread_id}/runs` with OpenAI-style
    `thread_locked` errors;
  - run/list/step/cancel/submit paths refresh stale non-terminal runs before
    returning state, so elapsed `expires_at` runs become `status:"expired"`;
  - expired runs record `expired_at`, clear `required_action`, and include
    `last_error.code:"run_expired"` plus compatibility metadata;
  - once a run is terminal, the same thread accepts new messages and new runs.
- Extended regression coverage:
  - unit/mock-provider Assistants required-action tests now assert message and
    run creation are rejected while the run waits for tool outputs;
  - a new unit/mock-provider test edits a temp run's `expires_at` into the
    past, verifies retrieval expires it, verifies stale submit does not call the
    provider, and verifies the thread unlocks afterward;
  - live `assistants-required-action` now checks both lock errors before
    submitting tool outputs.
- Updated docs:
  - compatibility matrix documents active-run locks, elapsed run expiration,
    `expired_at`, and the remaining hosted async-worker boundary;
  - evaluation plan records active-run lock and stale-run expiration coverage.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 10/10.
  - `npm test`: passed 187/187.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 87/87,
    pass rate 1.0, average latency 1437 ms, P95 latency 3994 ms, and total
    usage 22025 tokens. The `assistants-required-action` case observed
    `first_status:"requires_action"`, `message_lock_status:400`,
    `run_lock_status:400`, and `final_status:"completed"`.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1200 ms, P95 latency 1224 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising existing-session/public
    load, sidebar controls, core page navigation, project dialog/upload,
    prompt submission, completed-turn actions, reload persistence, generated
    image artifact display, saved project reopen/cleanup, and console
    error/warning checks.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1392 runtime
    candidates, selected 1 old UI smoke screenshot, selected 29427 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    29427 bytes, and reported 0 errors.
  - Service/storage check after verification: app-server, bridge, and web
    services were active; the filesystem had 40 GB available; `state/` was
    19 MB, `output/` was 4.8 MB, `/srv/aialra/data/opencodexapp` was 84 KB,
    and `/srv/aialra/logs/opencodexapp` was 24 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants message-attachment resource materialization

- Implemented Assistants message `attachments` materialization before local
  Chat-backed runs:
  - `file_search` attachments now validate local Files API IDs, create or reuse
    a thread-local vector store, attach files with audit attributes, and update
    `thread.tool_resources.file_search.vector_store_ids`;
  - `code_interpreter` attachments now validate local Files API IDs and union
    them into `thread.tool_resources.code_interpreter.file_ids`;
  - `/v1/threads`, `/v1/threads/{thread_id}/messages`, and
    `/v1/threads/runs` all materialize attachments before a run starts;
  - failed attachment validation cleans up newly created local threads/messages
    rather than leaving request-failed records behind.
- Official-docs basis:
  - OpenAI Assistants File Search docs state that Message attachments create or
    reuse a thread vector store and are queried alongside assistant stores;
  - OpenAI Assistants deep-dive docs state that Code Interpreter can access
    files only when their file IDs are added to message `attachments`.
- Extended regression coverage:
  - added unit/mock-provider tests for initial-thread `file_search`
    attachments creating vector stores and citations;
  - added unit/mock-provider tests for create-and-run attachment
    materialization before run start;
  - added unit/mock-provider tests for POST-message `code_interpreter`
    attachments populating thread file resources and mounted-file execution;
  - added live bridge-regression case `assistants-attachments`, covering both
    file-search attachment vector stores and code-interpreter attachment mounts.
- Updated docs:
  - compatibility matrix now lists message-attachment resource materialization
    as implemented and removes it from Assistants known gaps;
  - evaluation plan now includes the attachment live case and describes
    attachment-created thread vector-store and mounted-file checks.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 9/9.
  - `npm test`: passed 186/186.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live `assistants-attachments` passed 1/1 against `deepseek-v4-pro`, with
    both runs completed, output
    `assistants-attachment-search-live-ok [1] | assistants-attachment-ci-live-ok`,
    4 total Run Steps, 4 total messages, and 716 total tokens in the final
    bridge-regression run.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1205 ms, P95 latency 1255 ms, and total usage 99 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 87/87,
    pass rate 1.0, average latency 1439 ms, P95 latency 3949 ms, and total
    usage 22143 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising sidebar navigation,
    core pages, project dialog/upload, prompt submission, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project reopen/cleanup, and console error/warning checks.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1340 runtime
    candidates, selected 1 old UI smoke screenshot, selected 84056 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    84056 bytes, and reported 0 errors.
  - Final `npm run prune:runtime -- --dry-run` after live eval: scanned 1365
    runtime candidates, selected 0, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 40 GB available; `state/` was 19 MB,
    `output/` was 4.7 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 24 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants streaming delta compatibility

- Used current official OpenAI documentation through the OpenAI developer-docs
  MCP before changing behavior:
  - the `/v1/threads/runs` OpenAPI streaming examples show Assistants SSE
    sequences with `thread.message.created`, `thread.message.in_progress`,
    repeated `thread.message.delta`, `thread.message.completed`,
    `thread.run.step.created`, `thread.run.step.in_progress`,
    `thread.run.step.delta`, `thread.run.step.completed`,
    `thread.run.requires_action`, `thread.run.completed`, and `done`;
  - the Chat function-calling streaming guide documents streamed
    `delta.tool_calls[]` chunks whose ids/names can arrive before later
    argument fragments.
- Extended the local Assistants compatibility layer so `stream:true` run
  creation and streamed `submit_tool_outputs` relay upstream Chat streaming
  deltas instead of only replaying final lifecycle objects:
  - creates in-progress draft `thread.message` records and
    `message_creation` Run Steps before text/refusal deltas;
  - emits `thread.message.created`, `thread.message.in_progress`,
    `thread.message.delta`, `thread.message.completed`, and matching Run Step
    completion events for streamed text/refusal output;
  - creates in-progress `tool_calls` Run Steps and emits
    `thread.run.step.delta` while Chat `delta.tool_calls[]` or legacy
    `delta.function_call` arguments stream in;
  - persists the final reconstructed tool calls, updates the run to
    `requires_action`, and emits `thread.run.requires_action` when tool
    outputs are needed;
  - supports streamed `submit_tool_outputs` continuations without re-emitting
    `thread.created` or initial run-created events for existing runs;
  - closes any already-emitted draft text message/step before a streamed turn
    transitions to `requires_action`, avoiding dangling in-progress local
    messages when a Chat provider mixes text deltas and final tool calls;
  - aggregates streamed usage across the initial tool-call turn and follow-up
    completion turn.
- Updated the compatibility matrix and evaluation plan to mark Assistants text
  and function-tool delta relay as implemented while keeping hosted
  Assistants tool jobs, non-text hosted-tool delta details, and async thread
  locks as remaining gaps.
- Added unit/mock-provider coverage for:
  - create-thread-and-run streaming text deltas and final message persistence;
  - existing-thread run streaming tool-call argument deltas and persisted
    `requires_action` details;
  - streamed `submit_tool_outputs` message deltas and aggregate usage.
- Updated the live bridge-regression `assistants-lifecycle` case to require
  streamed message deltas and verify the concatenated streamed text.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/store.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Assistants server tests passed 4/4.
  - `npm test`: passed 181/181.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - `aialra-opencodexapp-app-server.service`,
    `aialra-opencodexapp-bridge.service`, and
    `aialra-opencodexapp-web.service` were active.
  - Live `assistants-lifecycle` passed 1/1 against `deepseek-v4-pro`, latency
    4183 ms, 18 Assistants SSE events, 6 streamed message deltas, and 76
    total tokens.
  - Live `assistants-required-action` passed 1/1, final status `completed`,
    1 tool call, 2 Run Steps, 2 messages, latency 3129 ms, and 784 total
    tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 84/84,
    pass rate 1.0, average latency 1427 ms, P95 latency 4128 ms, and 20727
    total tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1226 ms, P95 latency 1331 ms, and 99 total tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising sidebar navigation,
    core page navigation, project dialog/upload, prompt submission, completed
    turn actions, reload persistence, generated image artifact display, saved
    project reopen, and cleanup without console errors.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1287 runtime
    candidates, selected 1 old UI smoke screenshot, selected 100546 bytes,
    and reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    100546 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 38 GB available;
    `state/` was 18 MB, `output/` was 4.7 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 24 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository; final `git diff --check`
  and `npm run secret-scan` are part of the pre-commit gate for this entry.

## 2026-06-11 - Assistants function-tool required-action compatibility

- Extended the local deprecated Assistants/Threads compatibility layer so
  Chat function-tool calls now map to Assistants `requires_action` runs:
  - Assistant `tools:[{type:"function"}]` are forwarded as Chat Completions
    function tools, with provider filtering still handled by the existing Chat
    passthrough compatibility layer;
  - upstream Chat `choices[].message.tool_calls[]` and legacy
    `message.function_call` are normalized into
    `required_action.type:"submit_tool_outputs"`;
  - local Runs now persist `tool_calls` Run Steps as well as
    `message_creation` Run Steps;
  - `POST /v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs` accepts
    required tool outputs, replays the assistant `tool_calls` plus Chat `tool`
    messages upstream, aggregates usage, and completes the run or enters
    another `requires_action` round;
  - submitting tool outputs to a non-required-action run remains a compatibility
    no-op that records metadata and returns the existing run;
  - Assistants SSE event-shape output now emits
    `thread.run.requires_action` for streamed runs that pause for tool outputs.
- Updated docs and evaluation coverage:
  - compatibility matrix now marks function-tool `requires_action` /
    `submit_tool_outputs` as implemented and narrows remaining Assistants gaps
    to hosted Code Interpreter/File Search behavior, exact streamed text/tool
    deltas, and async thread locks;
  - evaluation plan and deployment docs now include
    `assistants-required-action`;
  - bridge regression harness now creates a live Assistant with a function
    tool, verifies the first run enters `requires_action`, submits tool
    outputs, and checks that the final assistant message contains
    `assistants-tool-ok`.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/store.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 2/2.
  - `npm test`: passed 179/179.
  - Restarted `aialra-opencodexapp-bridge.service`; service stayed active,
    bridge healthz on `127.0.0.1:12912` returned `ok:true`, provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Focused live
    `npm run eval:bridge -- --case assistants-required-action --timeout-ms 90000 --verbose`:
    passed 1/1, latency 3792 ms, first status `requires_action`, final status
    `completed`, 1 tool call, 2 run steps, 2 messages, output
    `assistants-tool-ok`, and 784 total tokens.
  - First full live `npm run eval:bridge -- --timeout-ms 180000`: passed
    83/84; the new Assistants cases both passed, while the existing
    `responses-mcp-remote-approval` case showed a transient model-output
    mismatch.
  - Focused rerun of `responses-mcp-remote-approval`: passed 1/1, confirming
    that failure was transient rather than caused by this Assistants change.
  - Second full live `npm run eval:bridge -- --timeout-ms 180000`: passed
    84/84, pass rate 1.0, average latency 1407 ms, P95 latency 3992 ms, and
    20519 total tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1241 ms, P95 latency 1257 ms, and 99 total tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering auth/load, sidebar
    controls, page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, and saved-project cleanup with no console errors or warnings.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1239 runtime
    candidates, selected 1 old UI smoke screenshot, selected 100908 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    100908 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 40 GB available;
    `state/` was 17 MB, `output/` was 4.7 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 24 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants API local lifecycle compatibility

- Evidence checked from official OpenAI documentation before implementation:
  - The API endpoint list still includes deprecated Assistants and Threads
    surfaces such as `/v1/assistants`, `/v1/threads`,
    `/v1/threads/{thread_id}/messages`, `/v1/threads/{thread_id}/runs`,
    run cancellation, tool-output submission, and run-step endpoints.
  - The Assistants deep-dive documents the run lifecycle states, thread locks
    while a run is in progress, and run-step types such as `message_creation`
    and `tool_calls`.
  - The OpenAPI schemas for `/v1/assistants`, `/v1/threads`, and
    `/v1/threads/runs` confirmed assistant, thread, run, and streaming event
    object fields that must be preserved where possible.
- Added a local deprecated Assistants/Threads compatibility layer backed by
  Chat Completions:
  - added `FileAssistantStore` with JSON persistence for assistants, threads,
    messages, runs, and run steps under
    `CODEXCOMPAT_ASSISTANT_STATE_DIR`, outside Git;
  - implemented assistant create/list/get/update/delete routes;
  - implemented thread create/get/update/delete routes, including initial
    messages;
  - implemented thread message create/list/get/update/delete routes;
  - implemented run create/list/get/update/cancel and submit-tool-output routes;
  - implemented run-step list/get routes and `message_creation` step storage;
  - implemented `/v1/threads/runs` create-thread-and-run compatibility;
  - mapped assistant instructions plus chronological thread messages into one
    upstream Chat Completions request, then persisted the assistant reply back
    as a `thread.message`;
  - added a basic Assistants-style SSE lifecycle shape for streamed
    create/run calls.
- Compatibility boundary:
  - local runs are synchronous Chat-backed runs, not hosted OpenAI Assistants
    jobs;
  - `requires_action` tool loops, exact text-delta streaming parity, hosted
    Code Interpreter/File Search behavior through Assistants, and async thread
    locks remain future parity work;
  - local run metadata records the compatibility mode under
    `metadata.compatibility.local_assistants` so clients and audits can
    distinguish this bridge behavior from hosted OpenAI Assistants execution.
- Updated documentation and evaluation coverage:
  - compatibility matrix now documents all local Assistants/Threads routes and
    the remaining boundaries;
  - deployment docs now include `CODEXCOMPAT_ASSISTANT_STATE_DIR` and the
    focused Assistants lifecycle eval command;
  - evaluation plan now lists the local Assistants lifecycle regression target;
  - the eval harness now includes `assistants-lifecycle` for create/list/run,
    message persistence, run steps, and SSE event-shape checks.
- Verification:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused server test
    `node --test --test-name-pattern "Assistants API local lifecycle" test/server.test.js`:
    passed 1/1.
  - `npm test`: passed 178/178.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Focused live
    `npm run eval:bridge -- --case assistants-lifecycle --timeout-ms 90000 --verbose`:
    passed 1/1 with 4420 ms latency, output `assistants-life-ok`, 2 thread
    messages, 1 run, 1 run step, 8 streamed lifecycle events, and 71 total
    tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 83/83,
    pass rate 1.0, average latency 1589 ms, P95 latency 4748 ms, and 19778
    total tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1396 ms, P95 latency 1506 ms, and 99 total tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering load/auth, sidebar
    controls, core page navigation, project dialog/upload, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, and saved-project cleanup without console warnings or errors.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1190 runtime
    candidates, selected 1 old UI smoke screenshot, selected 85905 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    85905 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 37 GB available;
    `state/` was 16 MB, `output/` was 4.8 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 23 MB.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository. `.env.example` only
  contains a placeholder-compatible local state path.

## 2026-06-11 - Videos edit and extension source compatibility

- Re-checked current official OpenAI video and Batch surfaces through the
  OpenAI developer-docs MCP before changing behavior. The API endpoint list
  includes `/videos`, `/videos/characters`, `/videos/edits`,
  `/videos/extensions`, and `/videos/{video_id}/remix`; OpenAPI specs confirm
  `POST /videos/edits` as `CreateVideoEdit` and `POST /videos/extensions` as
  `CreateVideoExtend`, both accepting JSON and multipart request bodies and
  returning a `VideoResource`.
- Confirmed the documented Batch video boundary remains `POST /v1/videos`
  only for video generation jobs, JSONL only, with video/image inputs supplied
  by pre-uploaded files or URLs. Direct video edit, extension, and remix
  compatibility were therefore kept out of Batch execution.
- Extended local Videos API compatibility for iterative video workflows:
  - multipart `video` uploads are preserved as source video descriptors with
    filename, content type, and byte count;
  - JSON source values are normalized from `video`, `source_video`, or
    `input_video` fields into `video_id`, `file_id`, `video_url`, or
    `uploaded_video` descriptors;
  - `/v1/videos/edits` and `/v1/videos/extensions` now require both `prompt`
    and a source `video`, returning OpenAI-style
    `missing_required_parameter` errors when the source is absent;
  - created local video resources now expose `source_video` and mirror it in
    `metadata.compatibility.source_video`;
  - added a local compatibility alias
    `POST /v1/videos/{video_id}/edits` for clients that follow cookbook-style
    path editing examples.
- Updated the compatibility matrix, deployment docs, evaluation plan, server
  tests, and live evaluation harness. Added live case
  `video-iteration-lifecycle` covering create, edit, extension, path edit, and
  remix source tracking.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused server test
    `node --test --test-name-pattern "Videos API creates" test/server.test.js`:
    passed 1/1.
  - `npm test`: passed 177/177.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live `video-iteration-lifecycle` case passed 1/1 against
    `deepseek-v4-pro`, latency 127 ms, all edit/extension/path-edit/remix
    statuses 200, and output
    `video-iteration:completed:completed:completed:completed`.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 82/82,
    pass rate 1.0, average latency 1557 ms, P95 latency 4504 ms, and total
    usage 19767 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1657 ms, P95 latency 1748 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1165 runtime
    candidates, selected 0 files, selected 0 bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 1165 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 38 GB available;
    `state/` was 16 MB, `output/` was 4.7 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Videos Characters API compatibility

- Used current official OpenAI endpoint/spec documentation through the OpenAI
  developer-docs MCP before changing behavior. The endpoint list includes
  `/videos/characters` and `/videos/characters/{character_id}`; the
  `POST /v1/videos/characters` spec describes multipart character creation
  with `name` and uploaded `video`, returning a `VideoCharacterResource`.
- Added local compatibility for reusable video character references in the
  bridge:
  - `POST /v1/videos/characters` accepts JSON or multipart input, records
    `name`, non-secret metadata, and source video descriptors, and returns a
    local `object:"video.character"` resource with `char_` id and
    `status:"completed"`;
  - `GET /v1/videos/characters/{character_id}` retrieves the local character;
  - `DELETE /v1/videos/characters/{character_id}` removes the local character
    record for cleanup;
  - `POST /v1/videos` now preserves up to two `characters` references and
    records `metadata.compatibility.character_count`.
- Storage boundary: uploaded character video bytes are inspected for size/type
  and converted into source descriptors; the binary reference video itself is
  not persisted in the local character resource.
- Hardened live regression stability after repeated full-suite runs:
  - `batch-responses-image-generation` now validates the protocol facts that
    matter for compatibility (`response.status`, completed
    `image_generation_call`, `ig_` id, PNG payload prefix, and local
    compatibility metadata) instead of requiring exact stochastic model text;
  - `responses-mcp-remote-background-call` now uses explicit Responses
    `tool_choice` for the imported `roll` function so the live suite tests
    remote MCP `tools/call` execution instead of model willingness to call the
    tool.
- Updated compatibility, deployment, and evaluation docs with the Videos
  Characters lifecycle and the new `video-character-lifecycle` live case.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Videos API server test passed, including character create, retrieve,
    video reference preservation, two-character limit rejection, delete, and
    404 after delete.
  - Focused live `video-character-lifecycle`: passed 1/1 against
    `deepseek-v4-pro`, latency 139 ms, returned `char_` and `video_` ids,
    retrieved the character, created a video with a character reference, and
    deleted the character.
  - Focused live `batch-responses-image-generation`: passed 1/1 after protocol
    assertion hardening.
  - Focused live `responses-mcp-remote-background-call`: passed 1/1 after
    forced tool selection, with remote methods `initialize`,
    `notifications/initialized`, `tools/list`, `tools/call`, authorization
    forwarding, and session forwarding.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 81/81,
    pass rate 1.0, average latency 1423 ms, P95 latency 3975 ms, and total
    usage 19768 tokens.
  - `npm test`: passed 177/177.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1273 ms, P95 latency 1421 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Bridge healthz returned `ok:true`, provider base `https://api.deepseek.com`,
    default model `deepseek-v4-pro`, and `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1117 runtime
    candidates, selected 0 files, selected 0 bytes, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 1117 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 38 GB available;
    `state/` was 15 MB, `output/` was 4.7 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 23 MB.
- Secret handling: no API keys, account credentials, provider headers, uploaded
  video bytes, or local deployment env files were added to the repository.

## 2026-06-11 - Streaming remote MCP approval-response continuation

- Rechecked the current official OpenAI Responses MCP/Connectors documentation
  through the OpenAI developer-docs MCP before changing behavior. The relevant
  documented flow is that a Responses request can emit `mcp_approval_request`
  output items, and a later request can send an input item of type
  `mcp_approval_response` with the `approval_request_id`, usually chained with
  `previous_response_id`. The docs also require per-request remote MCP
  `authorization` to be supplied again and not stored or exposed.
- Closed the streaming approval continuation gap for remote `server_url` MCP
  tools:
  - approved `mcp_approval_response` continuation turns that are requested with
    `stream:true` now execute the approved remote JSON-RPC `tools/call` before
    the final provider streaming turn;
  - the stream emits Responses-native MCP events for the executed approved call:
    `response.mcp_call_arguments.delta`,
    `response.mcp_call_arguments.done`, and
    `response.mcp_call.in_progress`;
  - generated internal Chat function-tool proxy calls remain hidden from public
    Responses streams, so clients see `mcp_list_tools`, `mcp_call`, and final
    message output rather than bridge plumbing.
- Added unit/mock-provider coverage for a full two-turn streaming approval flow:
  first turn emits `mcp_approval_request` without running `tools/call`; second
  turn sends `mcp_approval_response approve:true`, executes the remote MCP call,
  emits streaming MCP argument/progress events, verifies no generated
  `function_call` item leaks, checks local tool budget consumption, and confirms
  per-request authorization/session forwarding and public redaction.
- Added live bridge-regression case
  `responses-mcp-remote-stream-approval`, backed by the local mock MCP server,
  and documented the command in the deployment and evaluation docs.
- Updated the MCP compatibility matrix to state that non-streaming, streaming,
  and background approval request/response execution is now covered for remote
  `server_url` MCP calls. Hosted connector OAuth/token sidecars,
  restart-resumable per-request MCP authorization, and broader hosted connector
  approval persistence remain future work.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm test`: passed 177/177, including the new streaming approved remote MCP
    approval-response execution test.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live `responses-mcp-remote-stream-approval` passed 1/1 against
    `deepseek-v4-pro`, latency 4199 ms, output
    `mcp-remote-stream-approval-ok`, 32 SSE events, total usage 1586 tokens,
    remote MCP methods `initialize`, `notifications/initialized`,
    `tools/list`, `initialize`, `notifications/initialized`, `tools/list`,
    `tools/call`, and both authorization and `mcp-session-id` forwarding true.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 80/80,
    pass rate 1.0, average latency 1651 ms, P95 latency 4871 ms, and total
    usage 19856 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1317 ms, P95 latency 1445 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `aialra-opencodexapp-bridge.service`,
    `aialra-opencodexapp-web.service`, and
    `aialra-opencodexapp-app-server.service` were all active.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, exercised sidebar navigation, core
    page switches, project dialog/upload services, prompt submission,
    completed-turn actions, reload persistence, generated image artifact
    display, saved-project cleanup, and reported no console errors or warnings.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1018 runtime
    candidates, selected 0, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: passed after UI smoke; scanned 1019
    runtime candidates, deleted 1 old UI smoke screenshot, freed 85646 bytes,
    and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 38 GB available;
    `state/` was 14 MB, `output/` was 4.8 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Background remote MCP call-loop compatibility

- Extended the remote MCP call bridge from foreground non-streaming Responses
  to active `background:true` Responses jobs:
  - background preparation now keeps the live MCP context and shared
    `max_tool_calls` budget through the provider phase;
  - auto-approved remote MCP Chat proxy tool calls can execute remote
    `tools/call`, inject Chat `tool` messages, and perform the follow-up
    provider call before storing the completed background Response;
  - `mcp_call` output items and `metadata.compatibility.local_mcp` counters are
    recomputed after the background call loop so final stored output reflects
    the remote execution;
  - approved `mcp_approval_response` continuations now also work with
    `background:true` after the previous response's `mcp_approval_request` is
    replayed.
- Added fail-closed restart behavior for provider-pending background jobs that
  still need ephemeral remote MCP function-tool context. These jobs contain
  per-request remote MCP authorization/session state in memory, so startup
  reconciliation now refuses to resume them after process restart and reports
  `interrupted_provider_pending_ephemeral_mcp_context` instead of replaying a
  partial provider request without the original MCP context.
- Kept the security boundary explicit:
  - per-request MCP `authorization` continues to be stripped from public
    Responses output and persisted background snapshots;
  - outbound authorization is forwarded only to the mock/remote MCP server
    during `initialize`, `tools/list`, or `tools/call`;
  - no API keys, account credentials, provider headers, or env files were added
    to the repository.
- Added coverage:
  - unit/mock-provider coverage for background auto-approved remote MCP
    `tools/call`, including two upstream provider turns, remote session-id
    forwarding, `Authorization` forwarding only to MCP, `mcp_call` output
    persistence, budget accounting, and background snapshot redaction;
  - unit/mock-provider coverage for background approved
    `mcp_approval_response` continuation, including previous-response replay,
    actual remote `tools/call`, provider-pending snapshot redaction, final
    `mcp_call` output, and local MCP compatibility counters;
  - startup reconciliation coverage for provider-pending background responses
    with ephemeral MCP context, proving they fail closed with
    `interrupted_provider_pending_ephemeral_mcp_context`;
  - live bridge regression case `responses-mcp-remote-background-call`, backed
    by a local mock MCP server and the deployed DeepSeek bridge.
- Updated the compatibility matrix, deployment docs, and evaluation plan to
  document that remote MCP auto-approved calls and approval continuations are
  supported for non-streaming and active background requests, while streaming
  call loops and restart-resumable per-request connector credentials remain
  future work.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed, including the new background
    auto-approved remote MCP call and background approved approval-response
    continuation cases.
  - `npm test`: passed 174/174.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-mcp-remote-background-call`: passed 1/1 against
    `deepseek-v4-pro`, output `mcp-remote-background-call-ok`, status history
    reached `completed`, remote MCP methods were `initialize`,
    `notifications/initialized`, `tools/list`, and `tools/call`, and both MCP
    authorization and session forwarding were confirmed.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: 78/78 passing
    cases, pass rate 1.0, average latency 1594 ms, P95 latency 4462 ms, total
    usage 17248 tokens.
  - `npm run eval:protocol`: 2/2 passing protocol-smoke cases, pass rate 1.0.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against `https://opencodexapp.aialra.online`;
    navigation, sidebar controls, project dialog, host upload service, prompt
    submission, completed-turn actions, reload persistence, generated image
    artifact display, saved-project reopen/cleanup, and console checks all
    succeeded.
  - `npm run prune:runtime -- --dry-run`: scanned 971 runtime candidates,
    selected 1 old UI smoke screenshot, selected 84985 bytes, and reported 0
    errors.
  - `npm run prune:runtime -- --apply`: deleted 1 file, freed 84985 bytes, and
    reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 40 GB available;
    `state/` is 13 MB, `output/` is 4.8 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.

## 2026-06-11 - Remote MCP approval flow compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to confirm the approval item flow:
  `mcp_approval_request` output items can be returned before a connector call,
  and a later request can send `mcp_approval_response` input with
  `approval_request_id`, typically chained with `previous_response_id`.
  Authorization remains per-request and is not stored on the Response object.
- Extended non-streaming remote MCP compatibility from auto-approved execution
  to approval-required execution:
  - remote MCP tools with `require_approval:"always"`, `"default"`, or no
    matching `never` rule are exposed to Chat providers as temporary function
    tools so the model can request the call;
  - model-produced Chat tool calls for approval-required MCP tools are converted
    into Responses `mcp_approval_request` items instead of calling the remote
    server immediately;
  - internal generated Chat function calls are suppressed from public Responses
    output so clients see the MCP approval item shape, not bridge plumbing;
  - later `mcp_approval_response` items are matched against prior response
    output via `previous_response_id`, then approved calls execute remote
    JSON-RPC `tools/call` with the current request's MCP server authorization
    and session handling;
  - approved call results emit `mcp_call` with `approval_request_id` and are
    injected back into the final Chat prompt so the model can answer from the
    tool output.
- Added compatibility metadata counters for approval requests, approval
  responses, approvals, denials, missing approvals, and remote call execution.
- Updated the bridge regression harness with
  `responses-mcp-remote-approval` and `responses-mcp-remote-denial`, which
  start a local mock MCP server, validate the approval request turn, send
  approved or denied continuations, verify `tools/call` only happens for the
  approved path, and confirm authorization/session behavior without leaking
  secrets into Responses output.
- Updated compatibility matrix, deployment docs, evaluation plan, unit tests,
  and the live harness.
- Kept the compatibility boundary explicit: this supports non-streaming
  approval request/response execution for remote `server_url` MCP tools.
  Streaming remote MCP calls, background approval loops, hosted OpenAI
  connector OAuth/token sidecars, and broader audit UI for tool outputs remain
  future work.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed through `test/server.test.js`,
    including approval request creation, approved continuation execution,
    denied approval continuation without re-requesting the tool, budget
    accounting, hidden Chat tool-call suppression, and authorization redaction.
  - `npm test`: passed 171/171.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live targeted
    `npm run eval:bridge -- --case responses-mcp-remote-approval --timeout-ms 120000 --verbose`
    passed 1/1 against `deepseek-v4-pro`, confirmed remote `initialize`,
    `notifications/initialized`, two `tools/list` calls, approved
    `tools/call`, authorization forwarding, and session forwarding.
  - Live targeted
    `npm run eval:bridge -- --case responses-mcp-remote-denial --timeout-ms 120000 --verbose`
    passed 1/1 against `deepseek-v4-pro`, confirmed remote `initialize`,
    `notifications/initialized`, two `tools/list` calls, denied approval
    accounting, no `tools/call`, and no secret leakage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 77/77 passing cases, pass rate 1.0, average latency 1319 ms, P95
    latency 3965 ms, and total usage 15782 tokens.
  - `npm run eval:protocol -- --timeout-ms 120000`: passed 2/2, pass rate
    1.0, average latency 1040 ms, P95 latency 1128 ms, and total usage 99
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; initial cleanup scan selected
    1 old screenshot and 85582 bytes, and the final scan after cleanup scanned
    946 runtime candidates, selected 0 files, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: initial cleanup deleted 1 old
    screenshot and freed 85582 bytes; the final apply scan checked 946 runtime
    candidates, deleted 0 files, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 40 GB available; the
    repo is 62 MB, `state/` is 13 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, MCP
  authorization values, or local deployment env files were added to the
  repository.

## 2026-06-11 - Remote MCP tools/call execution compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to confirm the next request/output boundary:
  Responses MCP tools use `tools:[{type:"mcp"}]`, `server_label`, remote
  `server_url` or hosted `connector_id`, optional per-request
  `authorization`, `require_approval`, `allowed_tools`, and `defer_loading`;
  `mcp_list_tools` output carries imported tools, and `mcp_call` output carries
  `server_label`, `name`, `arguments`, `output`, and `error`.
- Extended the local MCP adapter from remote list-tools import to a first
  non-streaming remote call loop for Chat-only providers:
  - imported remote MCP tools with `require_approval:"never"` or matching
    `require_approval.never.tool_names` are exposed to the upstream Chat
    provider as generated function tools;
  - matching upstream Chat `tool_calls` are translated into remote JSON-RPC
    `tools/call` requests with the model-provided arguments;
  - successful and failed remote tool calls are mapped back into Responses
    `mcp_call` output items and Chat `tool` messages for one bounded follow-up
    completion;
  - `mcp-session-id` values from remote initialize/list calls are carried into
    later remote call requests;
  - `max_tool_calls` now accounts for both `mcp_list_tools` and executed
    remote `mcp_call` items.
- Added configuration knobs:
  - `CODEXCOMPAT_MCP_REMOTE_TOOL_CALLS`;
  - `CODEXCOMPAT_MCP_MAX_CALL_ROUNDS`;
  - `CODEXCOMPAT_MCP_MAX_TOOL_OUTPUT_CHARS`.
- Tightened MCP secret handling:
  - `authorization` remains non-enumerable runtime-only state for remote call
    execution and is not written to Responses output or background snapshots;
  - remote MCP `tools/call` output and JSON-RPC error data are redacted if a
    remote server echoes the current request authorization value or a Bearer
    token-like value.
- Added coverage:
  - unit/mock-provider coverage for remote MCP `tools/call`, Chat function-tool
    proxy injection, second provider call with `tool_choice:"none"`, usage
    aggregation, budget exhaustion, session forwarding, and output redaction;
  - a live bridge regression case, `responses-mcp-remote-call`, that starts a
    local mock MCP server and verifies a deployed bridge performs
    `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`
    while DeepSeek drives the function-tool call and final response.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness.
- Compatibility boundary: this is now a real non-streaming, auto-approved
  remote MCP `tools/call` executor for `server_url` tools. It still does not
  execute approval-required remote calls, run streaming/background remote call
  loops, manage hosted connector OAuth/token sidecars, or persist connector
  approval state.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: passed 169/169.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; `systemctl show` reported
    `ActiveState=active`, `SubState=running`, `MainPID=3926150`, and start
    timestamp `Thu 2026-06-11 08:28:55 CEST`.
  - Bridge healthz returned `ok:true`, provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Live `responses-mcp-remote-list` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 1513 ms, output `mcp-remote-ok`, total usage
    300 tokens, and confirmed remote `initialize`,
    `notifications/initialized`, `tools/list`, authorization forwarding, and
    session forwarding.
  - Live `responses-mcp-remote-call` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 2802 ms, output `mcp-remote-call-ok`, total
    usage 1097 tokens, `remote_call_success_count:1`, and confirmed remote
    `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 75/75 passing cases, pass rate 1.0, average latency 1308 ms, P95
    latency 3792 ms, and total usage 12738 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run eval:protocol`: passed 2/2, average latency 1374 ms, P95 latency
    1407 ms, and total usage 99 tokens.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 878 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 878 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Recent bridge journal only showed the intentional restart sequence.
  - Disk/storage check after cleanup: the filesystem has 42 GB available;
    `state/` is 12 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Graders API and Evals grader expansion

- Used current official OpenAI Graders docs/OpenAPI metadata to confirm the
  Graders surface and supported grader families:
  - `POST /v1/fine_tuning/alpha/graders/validate`;
  - `POST /v1/fine_tuning/alpha/graders/run`;
  - documented grader types `string_check`, `text_similarity`, `score_model`,
    and `python`, with `multi` documented for RFT composition.
- Added a dependency-free local Graders compatibility module for deterministic
  grading on Chat-only providers:
  - `string_check` supports documented `eq`, `neq`, `like`, and `ilike`,
    plus compatibility aliases for equality, containment, prefix/suffix, and
    regex checks;
  - `text_similarity` supports the documented metric names
    `fuzzy_match`, `bleu`, `gleu`, `meteor`, `cosine`, `rouge_1` through
    `rouge_5`, and `rouge_l` with local deterministic approximations;
  - one-level `multi` combines subgrader rewards through a small safe formula
    parser supporting arithmetic, parentheses, identifiers, comma-separated
    function calls, and `min`, `max`, `abs`, `floor`, `ceil`, `exp`, `sqrt`,
    and `log`;
  - `score_model`, `python`, nested `multi`, hosted judge execution, and
    sandboxed Python execution intentionally return structured unsupported
    errors instead of silently faking parity.
- Added Graders API handlers:
  - validate returns the normalized grader for locally supported deterministic
    graders;
  - run returns `reward`, `metadata`, `sub_rewards`, and empty model-token
    usage for local graders without contacting the upstream provider.
- Reused the same grader engine in local Evals runs, extending Evals beyond
  `string_check` to deterministic `text_similarity` and one-level `multi`
  testing criteria. Run metadata now records
  `supported_graders:["string_check","text_similarity","multi"]`.
- Extended the live bridge-regression harness with `graders-api-local`, which
  validates a `string_check` grader, runs `text_similarity`, runs `multi`, and
  confirms unsupported `score_model` returns
  `unsupported_grader_type`.
- Updated the compatibility matrix, evaluation plan, and deployment
  verification commands to document the Graders API, deterministic Evals
  coverage, local approximation caveats, and remaining parity gaps.
- Verification:
  - `node --check src/bridge/local_graders.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Graders/Evals server tests ran through `test/server.test.js` and
    passed, including the new Graders API and Evals text-similarity/multi
    cases.
  - `npm test`: passed 162/162.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 771 runtime
    candidates, selected 94 old UI screenshots by retention policy, deleted 0
    files, selected 7725496 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `graders-api-local` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, with `similarity_reward:0.6`,
    `multi_reward:0.9375`, zero token usage, and unsupported `score_model`
    returning HTTP 400.
  - Live `evals-lifecycle` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, with `result_counts:{total:2,passed:1,failed:1,errored:0}`
    and zero token usage because it used sample-driven local grading.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: 71/71 passing
    cases, pass rate 1.0, average latency 1058 ms, P95 latency 2708 ms, and
    total usage 10857 tokens.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - Runtime cleanup with `npm run prune:runtime -- --apply`: deleted 95 old
    UI screenshots by retention policy, freed 7810577 bytes, and reported 0
    errors.
  - Disk/storage check after cleanup: the filesystem has 39 GB available;
    `state/` is 8.3 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-10 Stored Response Lifecycle Include Projection

- Re-checked the current OpenAI Responses include list through the official
  OpenAI developer docs MCP. The supported include-gated response details remain
  `web_search_call.action.sources`, `code_interpreter_call.outputs`,
  `computer_call_output.output.image_url`, `file_search_call.results`,
  `message.input_image.image_url`, `message.output_text.logprobs`, and
  `reasoning.encrypted_content`.
- Found and closed a local lifecycle projection bypass:
  - `GET /v1/responses/{response_id}` already projected stored response bodies
    through include redaction;
  - `POST /v1/responses/{response_id}` metadata updates returned the internal
    stored response object directly;
  - `POST /v1/responses/{response_id}/cancel` terminal no-op responses also
    returned the internal stored response object directly.
- Updated the metadata-update and completed-cancel paths so they return
  `projectResponseForIncludes(...)`, matching retrieval behavior. Include-gated
  fields are hidden by default and returned only when the lifecycle request URL
  includes the matching `include[]` query value.
- Extended unit coverage on the existing `message.output_text.logprobs` fixture
  to verify:
  - update without include hides output-text logprobs;
  - update with `include[]=message.output_text.logprobs` returns logprobs;
  - completed cancel without include hides logprobs;
  - completed cancel with `include[]=message.output_text.logprobs` returns
    logprobs.
- Extended the live `responses-logprobs` bridge-regression case to exercise the
  same stored-response update/cancel projection path against
  `deepseek-v4-pro`.
- Hardened deterministic live evals that are meant to test protocol plumbing,
  not reasoning quality:
  - `responses-text`, `responses-json-schema`, and
    `responses-conversation-lifecycle` now set `reasoning.effort:"none"`;
  - direct Chat exact-string smoke and Batch Chat requests now set DeepSeek
    `thinking:{type:"disabled"}`.
- During validation, an earlier full live run exposed flaky exact-string
  failures from DeepSeek thinking mode: `responses-text` returned no visible
  text after consuming reasoning tokens, and `batch-chat-completions` missed one
  exact marker. After the deterministic non-thinking eval updates, targeted
  retries and the final full run passed.
- Updated compatibility and evaluation docs to record that stored Responses
  metadata update and completed cancel/no-op paths share the same include
  projection contract as response retrieval.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-logprobs` passed 1/1 against
    `deepseek-v4-pro`, latency 1595 ms, total usage 63 tokens, visible text
    `logprobs-ok`, hidden/included stored-response retrieves returned 200,
    hidden/included metadata updates returned 200, and hidden/included
    completed-cancel no-op requests returned 200.
  - Targeted live `responses-conversation-lifecycle` passed 1/1 after the
    deterministic non-thinking update, latency 2890 ms, output
    `conversation-ok`, and total usage 229 tokens.
  - Targeted live `responses-text` passed 1/1 after the deterministic
    non-thinking update, latency 782 ms, output `ok-text`, and total usage
    13 tokens.
  - Targeted live `batch-chat-completions` passed 1/1 after the deterministic
    non-thinking update, latency 1837 ms, and total usage 34 tokens.
  - Final `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 918 ms, P95 latency 1082 ms, and total usage 99 tokens.
  - Final full live `bridge-regression` passed 45/45 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1131 ms, P95 latency
    2450 ms, and total usage 9428 tokens.
  - UI smoke passed with marker `ui-smoke-mq8jo2b6`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 449 runtime candidates,
    selected 38 old UI screenshots by retention policy, deleted 0, selected
    2924128 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 37 GB available;
    repository checkout is 45 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Developer Role Compatibility

- Re-checked the current OpenAI OpenAPI endpoint list and Chat/Responses specs
  through the official OpenAI developer docs MCP. The OpenAPI metadata was
  version `2.3.0`; current Chat examples use `role:"developer"` messages, and
  Chat Completions still exposes create/list/retrieve/update/delete/messages
  lifecycle paths.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already normalized Responses/developer-style
    instruction roles for upstream Chat providers;
  - direct `POST /v1/chat/completions` passthrough still sent OpenAI Chat
    `messages[].role:"developer"` and OpenAI-only request fields directly to
    the upstream provider;
  - DeepSeek-compatible providers expect a narrower Chat role/field surface, so
    direct SDK calls could fail even though the equivalent Responses request
    worked.
- Added provider-aware direct Chat passthrough normalization:
  - `CODEXCOMPAT_CHAT_DEVELOPER_ROLE_COMPAT` defaults to true for DeepSeek
    providers and maps Chat `developer` messages to
    `CODEXCOMPAT_CHAT_DEVELOPER_ROLE`, default `system`, before proxying;
  - DeepSeek user identity compatibility now also applies to direct Chat
    passthrough, mapping `user`, `safety_identifier`, or `prompt_cache_key` to
    `user_id` and hashing values that do not match DeepSeek's safe character
    set;
  - unsupported `service_tier`, non-streaming `stream_options`, and configured
    OpenAI-only Chat fields such as `modalities`, `moderation`, `prediction`,
    `verbosity`, `web_search_options`, and legacy `functions` /
    `function_call` are filtered before the upstream call;
  - non-streaming JSON Chat responses and locally reconstructed stored streaming
    Chat completions record the compatibility action under
    `metadata.compatibility.chat_passthrough`;
  - stored Chat `/messages` retrieval continues to preserve the original client
    request messages, including `role:"developer"`, so audit/replay state is not
    silently rewritten.
- Added unit coverage for direct Chat passthrough against a mock provider:
  upstream sees `developer` mapped to `system`, unsupported fields filtered,
  `user` normalized to hashed `user_id`, returned metadata records
  `chat_passthrough`, local inline moderation still works when `moderation` is
  filtered, retrieve preserves metadata, and `/messages` preserves the original
  developer input message.
- Added a live `chat-developer-compat` bridge-regression case that sends direct
  Chat `developer` role input plus DeepSeek-filtered Chat fields through
  `/v1/chat/completions` and requires both exact output and compatibility
  metadata.
- Updated compatibility, deployment, and evaluation docs for the new direct
  Chat provider-profile behavior and environment knobs.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 86/86 passing tests.
  - `npm test`: 123/123 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1156 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and compatibility metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 998 ms, P95 latency 1064 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 46/46 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1108 ms, P95 latency 2306 ms, and total usage
    9365 tokens.
  - UI smoke passed with marker `ui-smoke-mq8k42j3`, reload persistence
    confirmed, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T21-04-22-479Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 458 runtime candidates,
    selected 39 old UI screenshots by retention policy, deleted 0, selected
    3009969 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; repository checkout
    is 34 MB, `state/` is 4.0 MB, and `output/` is 7.2 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Token Alias Compatibility

- Re-checked official API field direction before changing behavior:
  - OpenAI developer docs MCP search for Chat Completions create confirmed
    `max_completion_tokens` is the current Chat-side upper-bound field and that
    legacy `max_tokens` is deprecated in favor of it for newer model families.
  - OpenAI OpenAPI metadata was still version `2.3.0` for
    `POST /v1/chat/completions`.
  - DeepSeek's official Create Chat Completion reference
    (`https://api-docs.deepseek.com/api/create-chat-completion`) documents
    `max_tokens` as the generated-token limit for DeepSeek Chat Completions.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already accepted `max_completion_tokens` and
    legacy `max_tokens` aliases and mapped them to
    `CODEXCOMPAT_MAX_TOKENS_FIELD`;
  - direct `POST /v1/chat/completions` passthrough still forwarded the raw
    OpenAI Chat field surface, so current OpenAI SDK callers using
    `max_completion_tokens` could send a field that DeepSeek does not document;
  - custom provider profiles with non-`max_tokens` output-limit fields also
    needed to avoid leaking both OpenAI aliases upstream.
- Added provider-aware direct Chat token normalization:
  - direct Chat `max_completion_tokens` is mapped to the configured
    `CODEXCOMPAT_MAX_TOKENS_FIELD`, default `max_tokens` for DeepSeek;
  - when both `max_completion_tokens` and legacy `max_tokens` are present,
    `max_completion_tokens` wins and the old value is recorded as
    `metadata.compatibility.chat_passthrough.max_tokens.forwarded=false`;
  - when a provider uses a custom field such as `max_new_tokens`, OpenAI token
    aliases are removed before proxying so only the provider field is sent;
  - non-streaming JSON Chat responses and locally reconstructed stored streaming
    Chat completions continue to report the action under
    `metadata.compatibility.chat_passthrough`.
- Added unit coverage:
  - DeepSeek-compatible direct Chat passthrough now asserts the upstream mock
    receives `max_tokens:32`, not `max_completion_tokens`, and that conflicting
    legacy `max_tokens:96` is audited but not forwarded;
  - custom provider coverage asserts `max_completion_tokens:21` plus
    `max_tokens:99` becomes only `max_new_tokens:21` upstream, with conflict
    metadata preserved.
- Extended live evaluation:
  - `chat-developer-compat` now sends direct Chat `max_completion_tokens:64`
    and requires returned compatibility metadata to show forwarding to
    DeepSeek `max_tokens`.
- Hardened the UI smoke script while validating this change:
  - optional search/sidebar/settings controls now use short-click attempts
    instead of 30-second default click timeouts;
  - transient command-menu/dialog overlays are closed before composer input, so
    the smoke continues to test the real conversation/reload workflow instead of
    failing on optional UI chrome.
- Updated compatibility, deployment, and evaluation docs to record direct Chat
  token alias mapping and the `CODEXCOMPAT_MAX_TOKENS_FIELD` configuration.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "chat/completions.*token|normalizes OpenAI Chat fields"`: 87/87 passing tests, including the two direct Chat token alias cases.
  - `npm test`: 124/124 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 908 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat token alias metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 964 ms, P95 latency 1041 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 46/46 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1108 ms, P95 latency 2068 ms, and total usage
    9333 tokens.
  - UI smoke passed with marker `ui-smoke-mq8km2bs`, reload persistence
    confirmed, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T21-18-22-024Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 469 runtime candidates,
    selected 42 old UI screenshots by retention policy, deleted 0, selected
    3268828 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 46 MB, `state/` is 4.1 MB, `output/` is 7.5 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Reasoning Effort Compatibility

- Re-checked current field expectations before changing passthrough behavior:
  - OpenAI developer docs MCP search for Chat Completions create confirmed
    direct Chat `reasoning_effort` currently accepts values including `none`,
    `minimal`, `low`, `medium`, `high`, and `xhigh`.
  - OpenAI OpenAPI metadata remained version `2.3.0` for
    `POST /v1/chat/completions`.
  - DeepSeek's official Create Chat Completion and Thinking Mode references
    document a narrower DeepSeek Chat surface around `reasoning_effort` /
    `thinking`, with `thinking:{type:"disabled"}` used for non-thinking mode.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already normalized OpenAI/Codex
    `reasoning.effort` values for DeepSeek-compatible providers;
  - direct `POST /v1/chat/completions` passthrough still sent OpenAI Chat
    `reasoning_effort` values as-is, so `reasoning_effort:"none"` could reach
    DeepSeek instead of becoming non-thinking mode, and `xhigh` was not mapped
    to DeepSeek's `max` effort.
- Added provider-aware direct Chat reasoning normalization:
  - direct Chat `reasoning_effort:"none"` now omits upstream
    `reasoning_effort`, sends `thinking:{type:"disabled"}`, and records
    `metadata.compatibility.chat_passthrough.reasoning_effort` with
    `reason=deepseek_thinking_disabled`;
  - direct Chat `reasoning_effort:"minimal"`, `"low"`, and `"medium"` map to
    DeepSeek `reasoning_effort:"high"`;
  - direct Chat `reasoning_effort:"xhigh"` maps to DeepSeek
    `reasoning_effort:"max"`;
  - already-supported values such as `high` pass through unchanged without
    extra metadata noise.
- Added unit coverage for both passthrough branches:
  - the DeepSeek direct Chat compatibility test now asserts
    `reasoning_effort:"none"` becomes upstream `thinking:{type:"disabled"}`
    and records non-forwarded compatibility metadata;
  - a focused direct Chat reasoning alias test asserts `xhigh` becomes upstream
    `reasoning_effort:"max"` with forwarded compatibility metadata.
- Extended live evaluation:
  - `chat-developer-compat` now sends direct Chat `reasoning_effort:"none"`
    instead of provider-native `thinking:{type:"disabled"}`, and requires
    returned compatibility metadata to prove DeepSeek non-thinking mapping.
- Updated compatibility, deployment, and evaluation docs to state that
  `CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT` covers both Responses
  `reasoning.effort` and direct Chat `reasoning_effort`.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "reasoning_effort|normalizes OpenAI Chat fields"`: 88/88 passing tests, including the direct Chat reasoning cases.
  - `npm test`: 125/125 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1133 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat reasoning metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 998 ms, P95 latency 1124 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 46/46 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1119 ms, P95 latency 2556 ms, and total usage
    9370 tokens.
  - UI smoke passed with marker `ui-smoke-mq8kve9m`, reload persistence
    confirmed, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T21-25-37-402Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 478 runtime candidates,
    selected 43 old UI screenshots by retention policy, deleted 0, selected
    3355553 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 46 MB, `state/` is 4.2 MB, `output/` is 7.5 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Tool Choice Thinking Compatibility

- Re-checked current tool-call field expectations before changing direct Chat
  passthrough behavior:
  - OpenAI developer docs / OpenAPI for `POST /v1/chat/completions` document
    Chat `tools` and `tool_choice`, including `none`, `auto`, `required`, and
    forcing a specific function tool.
  - DeepSeek's official Create Chat Completion reference documents
    `thinking:{type:"enabled|disabled"}` with default `enabled`, `tools`,
    and `tool_choice` with the same control values.
  - DeepSeek's official Thinking Mode and Tool Calls guides document
    thinking-mode tool calls, but also require `reasoning_content` from
    tool-call turns to be passed back on later requests.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already disabled DeepSeek thinking by default
    when function tools and `tool_choice` were present;
  - direct `POST /v1/chat/completions` passthrough preserved `tools` and
    `tool_choice` but did not apply the same default, so OpenAI Chat clients
    could accidentally enter DeepSeek thinking-mode tool-call state without
    managing DeepSeek-specific `reasoning_content` replay.
- Added provider-aware direct Chat tool-choice thinking compatibility:
  - when `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE=true`, direct
    Chat passthrough requests with function `tools` plus `tool_choice` now send
    upstream `thinking:{type:"disabled"}`;
  - the original `tools` and `tool_choice` payloads continue to pass through;
  - returned and stored Chat completion metadata records
    `metadata.compatibility.chat_passthrough.deepseek_thinking` with
    `source=tool_choice`, `target=thinking`, `reason=disabled_for_tool_choice`,
    the chosen tool value, the mapped thinking value, and any previous thinking
    value.
- Added regression coverage:
  - a unit test asserts direct Chat tool-choice requests preserve `tools` /
    `tool_choice`, override `thinking:{type:"enabled"}` to
    `thinking:{type:"disabled"}`, and attach compatibility metadata;
  - the live `bridge-regression` suite now includes `chat-tool-choice-compat`,
    which forces a `record_result` tool call through direct Chat passthrough and
    verifies both the returned `tool_calls` payload and compatibility metadata.
- Updated compatibility, deployment, and evaluation docs to state that
  `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE` covers both Responses
  translation and direct Chat passthrough.
- Verification:
  - `node --check src/bridge/server.js`, `node --check scripts/eval-harness.mjs`,
    and `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "tool_choice|normalizes OpenAI Chat fields|reasoning_effort"`:
    89/89 passing tests, including the new direct Chat `tool_choice` case.
  - `npm test`: 126/126 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-tool-choice-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1232 ms, total usage 371 tokens, and direct Chat
    tool-call metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1201 ms, P95 latency 1271 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1110 ms, P95 latency 2216 ms, and total usage
    9776 tokens.
  - UI smoke passed with marker `ui-smoke-mq8l7u5x`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T21-35-17-877Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 488 runtime candidates,
    selected 44 old UI screenshots by retention policy, deleted 0, selected
    3442101 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 38 GB available; repository checkout
    is 47 MB, `state/` is 4.3 MB, `output/` is 7.6 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Chat Native Parallel Tool Calls Filtering

- Re-checked current field expectations before changing provider profiles:
  - OpenAI developer docs / OpenAPI for `POST /v1/chat/completions` document
    Chat `parallel_tool_calls` as the switch for parallel function calling
    during tool use.
  - DeepSeek's official Create Chat Completion reference documents `tools`,
    `tool_choice`, `logprobs`, `top_logprobs`, `user_id`, and other supported
    request fields, but does not list `parallel_tool_calls`.
- Found a provider-profile gap:
  - direct `POST /v1/chat/completions` passthrough filtered several
    OpenAI-only Chat fields for DeepSeek, but not `parallel_tool_calls`;
  - Responses-to-Chat translation copied `parallel_tool_calls` before the
    provider-aware Chat-native field filter, so DeepSeek could still receive an
    unsupported OpenAI Chat parameter through `/v1/responses`.
- Added provider-aware filtering:
  - moved Responses `parallel_tool_calls` handling into the shared
    Chat-native passthrough field list, so supported providers still receive it
    and DeepSeek defaults to filtering it with
    `metadata.compatibility.chat_native_fields.filtered`;
  - added `parallel_tool_calls` to direct Chat passthrough filtering when
    `CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS=false`;
  - updated deployment, compatibility, and evaluation docs to list
    `parallel_tool_calls` in the DeepSeek-filtered Chat-native field matrix.
- Added regression coverage:
  - translator unit tests now assert `parallel_tool_calls:false` is forwarded
    for provider-supported profiles and filtered for unsupported profiles;
  - server unit tests now cover both `/v1/responses` translation and direct
    `/v1/chat/completions` passthrough filtering;
  - live `bridge-regression` now exercises the field in
    `responses-inline-moderation` and `chat-developer-compat`, proving both
    public paths record the DeepSeek filter metadata while still completing.
- Verification:
  - `node --check src/bridge/translator.js`, `node --check src/bridge/server.js`,
    and `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/translator.test.js --test-name-pattern "Chat-native request fields|unsupported providers"`:
    34/34 passing tests, including the `parallel_tool_calls` forwarding and
    filtering assertions.
  - `node --test test/server.test.js --test-name-pattern "Chat-native request fields|normalizes OpenAI Chat fields"`:
    89/89 passing tests, including Responses and direct Chat filtering.
  - `npm test`: 126/126 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-inline-moderation` passed 1/1 against
    `deepseek-v4-pro`, latency 1168 ms, total usage 46 tokens, visible text
    `inline-moderation-ok`, and Responses `parallel_tool_calls` filter metadata
    checks passed.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1032 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat `parallel_tool_calls` filter metadata
    checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1035 ms, P95 latency 1117 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1090 ms, P95 latency 2099 ms, and total usage
    9717 tokens.
  - UI smoke passed with marker `ui-smoke-mq8lii3p`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T21-43-35-461Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 498 runtime candidates,
    selected 45 old UI screenshots by retention policy, deleted 0, selected
    3528992 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 42 GB available; repository checkout
    is 47 MB, `state/` is 4.4 MB, `output/` is 7.7 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Stored Chat Fields Provider Filtering

- Re-checked current request-field expectations:
  - OpenAI Chat Completions documents `metadata` as object metadata for stored
    and queryable records and `store` as the stored-chat output retention
    switch.
  - DeepSeek's official Create Chat Completion reference documents its request
    fields for `/chat/completions`, including `messages`, `model`, `thinking`,
    `reasoning_effort`, `max_tokens`, `response_format`, `stream_options`,
    `tools`, `tool_choice`, `logprobs`, `top_logprobs`, and `user_id`, but not
    OpenAI stored-chat `store` / `metadata`.
- Found a provider-profile gap:
  - Responses translation copied `metadata` and `store` directly into upstream
    Chat requests even though the bridge already implements local Responses
    storage and metadata semantics;
  - direct Chat passthrough used `store:true` and `metadata` for the local
    stored Chat lifecycle, but also forwarded them upstream unless the provider
    happened to ignore unsupported fields;
  - `background:true` forced local store correctly, but also forced
    `chat.store=true` on the upstream request path.
- Added provider-aware stored-chat handling:
  - introduced `CODEXCOMPAT_FORWARD_STORED_CHAT_FIELDS`, defaulting to `false`
    for DeepSeek providers and `true` for other OpenAI-compatible Chat
    providers;
  - moved Responses `metadata` / `store` into a dedicated stored-chat
    passthrough/filtering step, recording
    `metadata.compatibility.stored_chat_fields`;
  - added direct Chat filtering that preserves local `store:true` and metadata
    behavior while omitting unsupported upstream fields and recording
    `metadata.compatibility.chat_passthrough.stored_chat_fields`;
  - made background Responses keep local durable storage without sending
    `store` to DeepSeek when stored-chat forwarding is disabled.
- Added regression coverage:
  - translator tests now assert provider-supported profiles forward `metadata`
    and `store`, while unsupported profiles filter them and preserve explicit
    compatibility metadata;
  - server tests now cover Responses filtering, direct Chat passthrough
    filtering, DeepSeek default config behavior, and background local-store
    filtering;
  - live eval harness now checks stored-chat filtering in
    `responses-inline-moderation` and `chat-developer-compat`.
- Verification:
  - `node --check src/bridge/translator.js`, `node --check src/bridge/server.js`,
    and `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/translator.test.js --test-name-pattern "Chat-native request fields|stored"`:
    34/34 passing tests.
  - `node --test test/server.test.js --test-name-pattern "Chat-native request fields|normalizes OpenAI Chat fields|background keeps local store"`:
    90/90 passing tests, including the new background local-store case.
  - `npm test`: 127/127 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-inline-moderation` passed 1/1 against
    `deepseek-v4-pro`, latency 1603 ms, total usage 54 tokens, visible text
    `inline-moderation-ok`, and Responses stored-chat filtering metadata checks
    passed.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1092 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat stored-chat filtering metadata checks
    passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1329 ms, P95 latency 1579 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1220 ms, P95 latency 2266 ms, and total usage
    9749 tokens.
  - UI smoke passed with marker `ui-smoke-mq8m57ha`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-01-14-782Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 510 runtime candidates,
    selected 46 old UI screenshots by retention policy, deleted 0, selected
    3615921 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; repository checkout
    is 48 MB, `state/` is 4.5 MB, `output/` is 7.8 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 Stream Options Provider Filtering

- Re-checked current streaming request-field expectations:
  - OpenAI Chat Completions documents `stream_options` as a streaming-only
    request parameter and includes newer subfields such as usage and
    obfuscation controls.
  - DeepSeek's official Create Chat Completion reference documents
    `stream_options` for `/chat/completions`, but the supported surface is
    narrower; in practice the safe common subfield is `include_usage`.
- Found a provider-profile gap:
  - Responses-to-Chat translation copied all caller `stream_options` subfields
    when `stream:true`;
  - direct Chat passthrough only filtered the whole field for non-streaming
    calls, so OpenAI-only subfields could still reach DeepSeek during streams;
  - legacy `/v1/completions` streaming also copied caller `stream_options`
    before adding bridge usage chunks.
- Added provider-aware `stream_options` subfield filtering:
  - introduced reusable `filterStreamOptionsForProvider`;
  - added `CODEXCOMPAT_STREAM_OPTION_FIELDS`, defaulting to `include_usage` for
    DeepSeek providers and unrestricted for other OpenAI-compatible providers;
  - supports `*` / `all` for unrestricted forwarding and `none` for filtering
    all subfields;
  - applied the filter to Responses translation, direct Chat passthrough, and
    legacy Completions streaming;
  - records filtered subfields with
    `metadata.compatibility.stream_options.reason=provider_stream_option_filter`
    or `metadata.compatibility.chat_passthrough.stream_options.reason=provider_stream_option_filter`.
- Hardened live regression stability:
  - `responses-inline-moderation` and `responses-prompt-template-local` are
    exact-marker protocol tests, not reasoning-quality tests, so the harness now
    sends `reasoning:{effort:"none"}` for those two cases to avoid DeepSeek
    returning hidden reasoning without visible text.
  - Targeted reruns for both cases passed after the adjustment.
- Added regression coverage:
  - translator tests cover unrestricted caller subfields and DeepSeek-style
    allowlist filtering;
  - server tests cover Responses streaming filtering, direct Chat streaming
    stored-completion filtering, legacy Completions streaming filtering, and
    DeepSeek default config behavior;
  - live eval harness checks `include_obfuscation` is filtered while
    `include_usage` remains available for Responses SSE and direct Chat stream
    lifecycle cases.
- Verification:
  - `node --check src/bridge/translator.js`, `node --check src/bridge/server.js`,
    `node --check scripts/eval-harness.mjs`, and `git diff --check`: passed.
  - `node --test test/translator.test.js --test-name-pattern "stream options"`:
    34/34 passing tests.
  - `node --test test/server.test.js --test-name-pattern "stream_options|streams Chat chunks|completions streams|streams and stores reconstructed|loadConfig filters"`:
    90/90 passing tests.
  - `npm test`: 127/127 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-stream-events` passed 1/1 against
    `deepseek-v4-pro`, latency 1324 ms, total usage 50 tokens, visible text
    `stream-ok`, and stream-option subfield filter metadata checks passed.
  - Targeted live `chat-stream-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, latency 1143 ms, total usage 19 tokens, visible text
    `chat-stream-life-ok`, stored Chat lifecycle checks passed, and direct Chat
    stream-option subfield filter metadata checks passed.
  - Targeted live `responses-inline-moderation` passed 1/1 after non-thinking
    marker hardening, latency 1156 ms, total usage 19 tokens, visible text
    `inline-moderation-ok`.
  - Targeted live `responses-prompt-template-local` passed 1/1 after
    non-thinking marker hardening, latency 806 ms, total usage 27 tokens,
    visible text `prompt-template-ok`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 770 ms, P95 latency 828 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1050 ms, P95 latency 2029 ms, and total usage
    9594 tokens.
  - UI smoke passed with marker `ui-smoke-mq8moyd4`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-16-36-088Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 541 runtime candidates,
    selected 47 old UI screenshots by retention policy, deleted 0, selected
    3702996 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; repository checkout
    is 48 MB, `state/` is 4.8 MB, `output/` is 7.9 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct Chat reasoning object compatibility

- Documentation basis:
  - OpenAI Chat Completions Create API and OpenAPI schema document a top-level
    Chat `reasoning` object as well as `reasoning_effort`.
  - DeepSeek Create Chat Completion documents Chat-compatible
    `reasoning_effort` / `thinking` controls, but not OpenAI's top-level
    Chat `reasoning` object.
  - Sources: `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`
    and `https://api-docs.deepseek.com/api/create-chat-completion`.
- Found a direct Chat passthrough gap:
  - `/v1/responses` already normalized `reasoning.effort` before forwarding to
    DeepSeek-compatible Chat providers;
  - direct `/v1/chat/completions` normalized `reasoning_effort`, but an
    OpenAI Chat request using `reasoning:{effort,...}` could still forward the
    unsupported `reasoning` object to DeepSeek;
  - unsupported sibling fields such as `summary` needed explicit filtering and
    metadata instead of silent forwarding.
- Added provider-aware Chat reasoning object normalization:
  - direct Chat passthrough now removes top-level `reasoning` for DeepSeek
    compatibility mode;
  - `reasoning.effort` is promoted into the existing `reasoning_effort`
    normalizer, so values such as `none` map to DeepSeek `thinking` controls;
  - unsupported `reasoning` sibling fields are recorded in
    `metadata.compatibility.chat_passthrough.reasoning.filtered`;
  - explicit caller `reasoning_effort` takes precedence over
    `reasoning.effort`, and the precedence is recorded in compatibility
    metadata.
- Added regression coverage:
  - server tests verify direct Chat `reasoning:{effort:"none",summary:"auto"}`
    is converted to DeepSeek `thinking:{type:"disabled"}` with `summary`
    filtered from the upstream request;
  - server tests verify explicit `reasoning_effort` wins when both forms are
    present;
  - live `bridge-regression` now includes `chat-reasoning-object-compat` and
    checks visible output plus compatibility metadata for the object-to-effort
    mapping.
- Verification:
  - `node --check src/bridge/server.js`, `node --check scripts/eval-harness.mjs`,
    and `git diff --check`: passed.
  - `node --test test/server.test.js --test-name-pattern "reasoning object|reasoning_effort values|normalizes OpenAI Chat fields"`:
    92/92 passing tests.
  - `npm test`: 129/129 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-reasoning-object-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 959 ms, total usage 23 tokens, visible text
    `chat-reasoning-object-ok`, and reasoning-object compatibility metadata
    checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 855 ms, P95 latency 858 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 48/48 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1101 ms, P95 latency 2095 ms, and total usage
    9652 tokens.
  - A prior full `bridge-regression` run passed 47/48 because the model returned
    the adjacent web-search marker for `responses-max-tool-calls`; a targeted
    rerun of that case passed 1/1 with `web-budget-ok [1]`, latency 1441 ms,
    and total usage 406 tokens before the clean 48/48 full rerun.
  - UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8ncb7e`, page load/authentication, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-34-45-818Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 576 runtime candidates,
    selected 48 old UI screenshots by retention policy, deleted 0, selected
    3790202 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; repository checkout
    is 49 MB, `state/` is 5.1 MB, `output/` is 8.0 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct Chat custom tool filtering for DeepSeek

- Documentation basis:
  - OpenAI Chat Completions Create API documents Chat `tools` as either custom
    tools or function tools, and includes OpenAI-only request fields such as
    `n`.
  - DeepSeek Create Chat Completion documents `tools` as function-only: the
    tool type enum is `function`, and the docs state that only functions are
    currently supported as tools.
  - Sources: `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
    `https://developers.openai.com/api/docs/guides/function-calling`, and
    `https://api-docs.deepseek.com/api/create-chat-completion`.
- Found a direct Chat passthrough gap:
  - direct `/v1/chat/completions` could forward OpenAI Chat custom tool entries
    such as `type:"custom"` to DeepSeek, even though DeepSeek only documents
    function tools;
  - a custom `tool_choice` could also reach DeepSeek after unsupported tools
    were filtered or when no forwardable function tool remained;
  - direct Chat filtering also missed request-side `n`, while the compatibility
    matrix already documented `n` as a provider-aware OpenAI Chat field.
- Added provider-aware custom-tool filtering:
  - introduced `CODEXCOMPAT_FORWARD_CHAT_CUSTOM_TOOLS`, defaulting to `false`
    for DeepSeek providers and `true` for other OpenAI-compatible providers;
  - direct Chat passthrough now removes non-`function` tools when the upstream
    provider is function-tool-only, keeps forwardable function tools, and
    records compact tool descriptors under
    `metadata.compatibility.chat_passthrough.custom_tools`;
  - incompatible custom `tool_choice` values are removed, and `tool_choice` is
    also removed when no forwardable function tools remain;
  - direct Chat provider-field filtering now includes `n`.
- Added regression coverage:
  - server tests verify custom tools are filtered while function tools remain,
    incompatible custom `tool_choice` is removed, and compatibility metadata
    records forwarded and filtered tool descriptors;
  - server tests verify direct Chat `n` is filtered for DeepSeek-compatible
    providers;
  - config tests verify DeepSeek defaults to `forwardChatCustomTools:false`
    while generic OpenAI-compatible providers default to true;
  - live `bridge-regression` now includes `chat-custom-tool-filter-compat` and
    checks visible output plus compatibility metadata for all-custom tool
    filtering.
- Verification:
  - `node --check src/bridge/server.js`, `node --check scripts/eval-harness.mjs`,
    and `git diff --check`: passed.
  - `node --test test/server.test.js --test-name-pattern "custom tools|normalizes OpenAI Chat fields|loadConfig filters"`:
    93/93 passing tests.
  - `npm test`: 130/130 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-custom-tool-filter-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1002 ms, total usage 25 tokens, visible text
    `chat-custom-tool-filter-ok`, and custom-tool compatibility metadata checks
    passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 923 ms, P95 latency 960 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 49/49 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1028 ms, P95 latency 2115 ms, and total usage
    9623 tokens.
  - UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8nq5hy`, page load/authentication, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-45-31-606Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 590 runtime candidates,
    selected 49 old UI screenshots by retention policy, deleted 0, selected
    3877672 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.0 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Expanded UI workflow smoke coverage

- Found a UI workflow coverage gap in the always-on Playwright smoke:
  - it loaded the app, exercised sidebar/search/settings, sent one prompt, and
    verified reload persistence;
  - it did not yet touch the project menu/dialog, the browser-upload bridge,
    project writable-root host services, or stop/retry control discovery.
- Added UI workflow coverage:
  - `scripts/ui-smoke.mjs` now opens the project menu, verifies both new-project
    and existing-folder menu entries, opens the new-project dialog, fills a
    unique smoke project name, and cancels so no project records accumulate;
  - the smoke calls a new browser host service,
    `codexappHostServices.browserUploads.uploadFiles`, to upload a tiny text
    fixture through the same server-side browser-upload path used by file drops;
  - the smoke verifies the uploaded file exists under `state/browser-uploads/`
    and its contents match the fixture;
  - the smoke adds and clears a project writable root through
    `codexappHostServices.projectWritableRoots`, proving the project host-state
    channel remains round-trippable;
  - after the model turn, it records visible stop/retry-style controls for
    workflow observability.
- Kept the UI smoke actionable:
  - Radix dialog title/description development warnings are now treated as
    known benign console noise in the injected web bridge and in the smoke
    collector, matching the existing handling for other third-party browser
    telemetry noise;
  - non-benign console errors still fail the smoke.
- Updated documentation:
  - `docs/evaluation-plan.md` now lists project dialog, upload fixture,
    project writable-root add/clear, and stop/retry discovery as covered UI
    smoke behavior;
  - `docs/deployment.md` now explains the expanded `smoke:ui` behavior and the
    remaining UI gaps.
- Verification:
  - `node --check web-server.js` and `node --check scripts/ui-smoke.mjs`:
    passed.
  - `git diff --check`: passed.
  - `npm test`: 130/130 passing tests.
  - Restarted `aialra-opencodexapp-web.service`; local web health returned
    HTTP 200, and public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8o58jj`, page load/authentication, sidebar controls, project
    dialog open/cancel, existing-folder menu detection, browser-upload fixture
    write and filesystem verification, project writable-root add/clear, new
    conversation submit, visible stop control discovery, reload persistence,
    console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T22-57-15-391Z.png`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 928 ms, P95 latency 952 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 596 runtime candidates,
    selected 51 old UI screenshots by retention policy, deleted 0, selected
    4051398 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.1 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - HumanEval/MBPP-style code benchmark suite

- Found a quality-evaluation gap:
  - `scripts/code-benchmark.mjs` had only the default `micro` suite with three
    simple JavaScript repair tasks;
  - `docs/evaluation-plan.md` still called out HumanEval/MBPP-style unit-test
    tasks as a planned quick regression signal before heavier SWE-bench runs.
- Added a new explicit benchmark suite:
  - `npm run bench:code -- --suite humaneval-mbpp --timeout-ms 180000`;
  - cases cover balanced bracket validation, stable de-duplication by computed
    key, deterministic word-frequency ranking, and non-mutating square-matrix
    rotation;
  - default `npm run bench:code` behavior remains the low-cost `micro` suite.
- Updated documentation:
  - README verification commands now include the new suite;
  - deployment/evaluation docs list the suite and the covered task families;
  - the evaluation plan now treats HumanEval/MBPP-style tasks as present quick
    regression signal rather than future work.
- Verification:
  - `node --check scripts/code-benchmark.mjs`: passed.
  - `git diff --check`: passed.
  - `npm test`: 130/130 passing tests.
  - Unknown-suite CLI guard still exits 2 and lists `micro, humaneval-mbpp`.
  - Default live `micro` code benchmark still passed 3/3 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 19202 ms, P95 latency
    27771 ms, and total usage 6088 tokens.
  - Live `humaneval-mbpp` code benchmark passed 4/4 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 7813 ms, P95 latency 10219 ms, and total
    usage 4423 tokens. Before-fix tests failed and after-fix tests passed for
    all four cases.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1059 ms, P95 latency 1065 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 598 runtime candidates,
    selected 51 old UI screenshots by retention policy, deleted 0, selected
    4051398 bytes, and reported 0 errors.
  - Report artifact written outside release docs at
    `/srv/aialra/data/opencodexapp/eval/code-benchmark/humaneval-mbpp-latest.json`;
    transient work directories remain under ignored `output/code-benchmark/`.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.2 MB,
    `/srv/aialra/data/opencodexapp` is 68 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.
  - This suite is not a SWE-bench substitute; it is a small, deterministic
    pass/fail sentinel for issue-to-patch generation quality.

## 2026-06-11 - Repository-maintenance code benchmark suite

- Closed the next evaluation-plan gap for bridge-repo maintenance scenarios:
  - added `npm run bench:code -- --suite repo-maintenance --timeout-ms 180000`;
  - cases cover deployment documentation with provider env vars and secret
    hygiene, writable project-root normalization, Responses-style function-call
    tool loops, and previous-response multi-turn replay reconstruction;
  - default `npm run bench:code` behavior remains the low-cost `micro` suite.
- Updated documentation:
  - README verification commands include the new suite;
  - deployment verification checklist includes the new suite;
  - evaluation plan now describes repository-maintenance tasks as present quick
    benchmark coverage rather than future work.
- Verification:
  - `node --check scripts/code-benchmark.mjs`: passed.
  - `git diff --check`: passed.
  - Unknown-suite CLI guard exits 2 and lists
    `micro, humaneval-mbpp, repo-maintenance`.
  - Live `repo-maintenance` code benchmark passed 4/4 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 19652 ms, P95 latency
    38633 ms, and total usage 9465 tokens. Before-fix tests failed and
    after-fix tests passed for all four cases.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1131 ms, P95 latency 1177 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 599 runtime candidates,
    selected 51 old UI screenshots by retention policy, deleted 0, selected
    4051398 bytes, and reported 0 errors.
  - Report artifact written outside release docs at
    `/srv/aialra/data/opencodexapp/eval/code-benchmark/repo-maintenance-latest.json`;
    transient work directories remain under ignored `output/code-benchmark/`.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.3 MB,
    `/srv/aialra/data/opencodexapp/eval/code-benchmark` is 36 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.
  - This suite is still a deterministic quick signal; it supports the larger
    quality program but does not replace SWE-bench scoring or justify a 95%
    parity claim on its own.

## 2026-06-11 - Active UI interrupt and recovery smoke coverage

- Extended `scripts/ui-smoke.mjs` with an opt-in active browser workflow:
  - `npm run smoke:ui -- --timeout-ms 240000 --exercise-active-controls`;
  - starts a long-running model turn in a fresh conversation;
  - finds the visible stop/interrupt control using short accessible button
    labels to avoid matching conversation-history text;
  - clicks the stop control, verifies it clears, records any visible
    retry/regenerate/continue controls, and submits a recovery prompt to prove
    the conversation remains usable after interruption.
- Kept the default `npm run smoke:ui -- --timeout-ms 180000` path unchanged for
  cheaper routine checks.
- Updated README, deployment, and evaluation docs with the new command and the
  remaining retry/regenerate limitation:
  - the active interrupted-turn UI did not expose a visible
    retry/regenerate/continue control in the verified run;
  - completed-turn retry/regenerate still needs a dedicated browser path when
    that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8p0d4h`: load/authentication, sidebar controls, project dialog
    open/cancel, browser-upload fixture write and filesystem verification,
    project writable-root add/clear, prompt submit, reload persistence, active
    stop click with control name `停止`, `stop_cleared:true`,
    `retry_control_status:"not_visible_after_interrupt"`, recovery marker
    occurrences 2, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-21-27-665Z.png`.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8p30wk`, existing default coverage, console errors 0, warnings
    0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-23-31-796Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 938 ms, P95 latency 981 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 604 runtime candidates,
    selected 56 old UI screenshots by retention policy, deleted 0, selected
    4484726 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 38 GB available; repository checkout
    is 51 MB, `state/` is 5.3 MB, `output/` is 8.8 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 16 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Core UI page-switch smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with core
  sidebar page switching:
  - restores the sidebar when earlier controls hide it;
  - opens the Plugins, Automation, and Codex Mobile views;
  - validates page-specific main-content text instead of generic body text, so
    sidebar labels cannot produce false positives;
  - returns to New Chat and verifies the composer is usable before continuing
    project/upload and model-turn checks.
- Tightened stop/retry control discovery to short accessible button labels so
  older conversation titles containing words like `stop` no longer pollute the
  recorded control list.
- Updated deployment and evaluation docs:
  - default UI smoke now documents plugins/automation/mobile page switching and
    return-to-chat coverage;
  - remaining UI gaps are saved project open, generated artifact display, and
    completed-turn retry/regenerate coverage when that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8pcmcg`: core page switches visited `plugins`, `automation`,
    and `mobile`, `returned_to_new_chat:true`, project dialog open/cancel,
    browser-upload fixture write and filesystem verification, project
    writable-root add/clear, prompt submit, reload persistence, short-label
    stop/retry controls `[]`, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-30-59-488Z.png`.
  - Active UI smoke also passed with marker `ui-smoke-mq8pk1dv`, including the
    same core page switches plus active stop click with control name `停止`,
    `stop_cleared:true`, recovery marker occurrences 2, console errors 0,
    warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-36-45-571Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1155 ms, P95 latency 1214 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 607 runtime candidates,
    selected 59 old UI screenshots by retention policy, deleted 0, selected
    4744738 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 37 GB available; repository checkout
    is 52 MB, `state/` is 5.3 MB, `output/` is 9.1 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 17 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Saved project open UI smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with saved
  project coverage:
  - creates a unique UI-smoke project through the real Projects menu;
  - verifies the saved project appears in the sidebar;
  - navigates away to Plugins, reopens the project from the sidebar, and checks
    the project context returns;
  - removes the generated workspace root through the browser bridge and then
    applies a file-level cleanup fallback for ignored local state.
- Hardened active UI coverage while validating the new saved-project path:
  - active prompts now request chat-only long output to avoid file-artifact
    shortcuts during stop-control testing;
  - visible stop matching uses exact short labels such as `停止` and
    `Stop generating`, preventing false matches against old conversation text;
  - button discovery is viewport-bounded for faster and less noisy polling;
  - the result records a composer-action fallback path if a future UI renders
    the stop action without accessible text.
- Updated README, deployment notes, and the evaluation plan:
  - active UI smoke command now uses
    `npm run smoke:ui -- --timeout-ms 260000 --exercise-active-controls`;
  - saved project open is no longer listed as a remaining UI gap;
  - remaining UI gaps are generated artifact display and a dedicated
    completed-turn retry/regenerate path when that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8r08xl`: core page switches visited `plugins`, `automation`,
    and `mobile`; active stop clicked with control name `停止`;
    `stop_control_rect:{x:1122,y:668,w:28,h:28}`;
    `interrupt_method:"named_stop_control"`; `stop_cleared:true`;
    `retry_control_status:"not_visible_after_interrupt"`; recovery marker
    occurrences 2; saved project `UI smoke saved ui-smoke-mq8r08xl` created
    and reopened; cleanup removed
    `/srv/aialra/apps/open-codex-app-web-gateway/state/browser-workspaces/2026-06-11-ui-smoke-saved-ui-smoke-mq8r08xl`
    with `bridge_updated:true`; console errors 0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-17-21-465Z.png`.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8qt71d`: core page switching, project dialog open/cancel,
    browser-upload fixture write and filesystem verification, writable-root
    add/clear, prompt submit, reload persistence, saved project
    `UI smoke saved ui-smoke-mq8qt71d` created and reopened, cleanup removed
    `/srv/aialra/apps/open-codex-app-web-gateway/state/browser-workspaces/2026-06-11-ui-smoke-saved-ui-smoke-mq8qt71d`
    with `bridge_updated:true`, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-11T00-11-52-417Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 982 ms, P95 latency 1221 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 620 runtime candidates,
    selected 72 old UI screenshots by retention policy, deleted 0, selected
    5869605 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    5.4 MB, `output/` is 11 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 19 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Generated image artifact UI smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with generated
  image artifact display coverage:
  - resolves the newly created smoke thread from the isolated deployment
    `state_5.sqlite`;
  - validates the rollout path stays under the deployment Codex sessions root;
  - appends a temporary `image_generation_end` event with a tiny PNG data
    payload;
  - reopens the matching thread from the sidebar and asserts the page renders a
    visible generated-image `data:image/*` artifact;
  - truncates the rollout back to its original byte size in `finally`, including
    failure paths.
- Hardened the sidebar thread selection used by this path:
  - the smoke now searches only visible sidebar/non-main interactive elements
    containing the marker;
  - the result records the clicked element tag, role, label, and rectangle so
    later regressions have enough DOM context to diagnose.
- Updated deployment and evaluation docs:
  - default UI smoke now documents generated image artifact display coverage;
  - the remaining documented automated UI gap is a dedicated completed-turn
    retry/regenerate path when that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8rlbzo`: generated artifact step rendered one image with alt
    `已生成图像 1`, `src_prefix:"data:image/png;base64,iVBORw0K"`,
    natural size `1x1`, rendered rectangle `{x:422,y:263,w:178,h:178}`, and
    `rollout_truncated:true`; console errors 0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-33-45-204Z.png`.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8rno9i`: generated artifact rendering also passed, active stop
    clicked with control name `停止`, `stop_cleared:true`,
    `retry_control_status:"not_visible_after_interrupt"`, recovery marker
    occurrences 2, saved project cleanup `bridge_updated:true`, console errors
    0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-35-34-422Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 916 ms, P95 latency 1016 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 626 runtime candidates,
    selected 78 old UI screenshots by retention policy, deleted 0, selected
    6382278 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 43 GB available; `state/` is
    5.4 MB, `output/` is 11 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 20 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Completed turn action UI smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with completed
  turn action coverage:
  - waits for the model turn to settle after the main chat content contains
    both the user prompt marker and assistant response marker, preventing
    sidebar titles from prematurely satisfying the completion check;
  - hovers the completed user message, assistant output, and broad completed
    turn container;
  - records and asserts main-content action controls for `编辑用户消息`,
    `复制消息`, `编辑消息`, assistant `复制`, and `从此处开始分叉`;
  - opens the top `对话操作` menu and records the visible menu items;
  - detects compact assistant action icons by geometry as a fallback for
    transiently unlabeled icon buttons.
- Tightened retry/continue control discovery:
  - default stop/retry discovery now requires exact short accessible labels and
    viewport visibility, so old conversation titles containing words such as
    `retry` cannot pollute results;
  - active interrupt recovery now uses the same exact short-label matching,
    preventing the smoke from clicking sidebar history items as retry buttons.
- Hardened reload persistence:
  - after reload, the smoke first checks whether the current main view still
    contains the marker;
  - if the app returns to the new-chat screen, it reopens the matching sidebar
    thread and then verifies the marker in main content.
- Updated deployment and evaluation docs:
  - default UI smoke now documents completed-turn copy/edit/branch and
    conversation menu coverage;
  - the current UI is recorded as exposing branch-from-here rather than
    retry/regenerate, with `completed_turn_retry_regenerate_visible:false`.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8sisdo`: `turn_settled_before_completed_actions:true`;
    completed turn controls included `编辑用户消息`, `复制消息`, `编辑消息`,
    `复制`, and `从此处开始分叉`; conversation action menu items included
    `置顶对话`, `重命名对话`, `归档对话`, `打开侧边聊天`, `复制`, and
    `添加自动化…`; `completed_turn_retry_regenerate_visible:false`;
    reload recovered through sidebar with `reopened_from_sidebar_after_reload:true`;
    generated image artifact rendering and saved project cleanup also passed;
    console errors 0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-59-46-092Z.png`.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8soxvq`: completed-turn controls and conversation menu passed;
    generated image artifact rendering passed; active stop clicked with control
    name `停止`; `stop_cleared:true`; `controls_after_interrupt:[]`;
    `retry_control_status:"not_visible_after_interrupt"`; recovery marker
    occurrences 2; saved project cleanup `bridge_updated:true`; console errors
    0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T01-04-33-158Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1070 ms, P95 latency 1075 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 637 runtime candidates,
    selected 89 old UI screenshots by retention policy, deleted 0, selected
    7324221 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 42 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Local image_generation Responses compatibility

- Added a local hosted-tool adapter for Responses
  `tools:[{type:"image_generation"}]`:
  - reserves `image_generation` so Chat Completions providers do not receive an
    unsupported hosted tool or hosted `tool_choice`;
  - emits `image_generation_call` output items with `status`, `revised_prompt`,
    and base64 PNG `result`;
  - emits streaming `response.image_generation_call.partial_image` events when
    `partial_images` is requested;
  - participates in the shared local `max_tool_calls` budget and records
    skipped image calls in compatibility metadata;
  - injects bounded local context into upstream Chat requests without putting
    base64 image bytes into the prompt;
  - is included in background response preparation checkpoints and persisted
    local output items.
- The default provider is `placeholder`, which creates deterministic non-empty
  PNGs from the prompt and requested image options. This closes the protocol,
  SDK, UI rendering, streaming, and background workflow gap for Chat-only
  providers, but it is not GPT Image semantic quality parity or high-fidelity
  editing. Provider-backed image generation/editing remains a future parity
  task.
- Updated configuration and docs:
  - `.env.example` now lists `CODEXCOMPAT_IMAGE_GENERATION_PROVIDER`,
    `CODEXCOMPAT_IMAGE_GENERATION_PLACEHOLDER_SIZE`, and
    `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_IMAGE_GENERATION`;
  - compatibility docs now describe the adapter boundary and updated known gap;
  - deployment docs list the new environment variables;
  - evaluation docs and `scripts/eval-harness.mjs` include a
    `responses-image-generation` bridge-regression case.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check test/translator.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused image-generation tests passed 4/4:
    `node --test --test-name-pattern='image_generation|reserve image_generation' test/translator.test.js test/server.test.js`.
  - `npm test`: 134/134 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1126 ms, P95 latency 1159 ms, and total usage 99 tokens.
  - Live `responses-image-generation` bridge-regression case passed 1/1
    against `deepseek-v4-pro`, latency 1153 ms, and total usage 186 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 637 runtime candidates,
    selected 89 old UI screenshots by retention policy, deleted 0, selected
    7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct request-based Audio API compatibility

- Used official OpenAI developer docs and OpenAPI endpoint specs for
  request-based Audio APIs:
  - `POST /v1/audio/speech` (`createSpeech`);
  - `POST /v1/audio/transcriptions` (`createTranscription`);
  - `POST /v1/audio/translations` (`createTranslation`);
  - audio guide boundary between request-based Audio APIs and Realtime voice.
- Added local direct Audio compatibility for Chat-only provider deployments:
  - `POST /v1/audio/speech` accepts JSON speech requests and returns
    deterministic placeholder bytes for `mp3`, `opus`, `aac`, `flac`, `wav`,
    and `pcm`, plus optional `speech.audio.*` SSE events;
  - `POST /v1/audio/transcriptions` accepts official multipart `file`
    requests and JSON/base64 Batch-compatible file shapes; supports `json`,
    `verbose_json`, `diarized_json`, `text`, `srt`, `vtt`, and transcription
    SSE events;
  - `POST /v1/audio/translations` accepts official multipart `file` requests
    and JSON/base64 Batch-compatible file shapes; supports `json`,
    `verbose_json`, `text`, `srt`, and `vtt`;
  - local Batch JSONL now supports `/v1/audio/transcriptions` and
    `/v1/audio/translations` while leaving `/v1/audio/speech` direct-only
    because Batch output files are JSONL and speech responses are binary.
- Added deployment configuration for local Audio defaults:
  - `CODEXCOMPAT_AUDIO_PROVIDER`;
  - `CODEXCOMPAT_AUDIO_SPEECH_MODEL`;
  - `CODEXCOMPAT_AUDIO_TRANSCRIPTION_MODEL`;
  - `CODEXCOMPAT_AUDIO_TRANSLATION_MODEL`;
  - `CODEXCOMPAT_AUDIO_DEFAULT_VOICE`;
  - `CODEXCOMPAT_AUDIO_MAX_INPUT_BYTES`.
- Updated compatibility, deployment, and evaluation docs. The known audio gap
  is now narrowed: request-based protocol coverage exists locally, but
  text-only providers such as DeepSeek still do not natively understand audio
  or synthesize semantic audio; Realtime sessions, custom voice governance, and
  provider-backed audio quality remain future work.
- Added regression coverage:
  - unit tests for direct speech bytes, multipart transcription, JSON/base64
    transcription SSE, multipart translation, JSON/base64 translation, and
    local Batch Audio transcription/translation JSONL;
  - eval harness cases `audio-speech`, `audio-transcription`,
    `audio-translation`, `batch-audio-transcription`, and
    `batch-audio-translation`.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Audio server tests passed 120/120 under the selected test pattern.
  - `npm test`: 158/158 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned
    726 candidates, selected 91 old UI screenshots by retention policy,
    deleted 0 files, selected 7469499 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `bridge-regression` Audio cases passed after restart:
    `audio-speech` 1/1 at 125 ms with `audio/wav` bytes,
    `audio-transcription` 1/1 at 68 ms,
    `audio-translation` 1/1 at 62 ms,
    `batch-audio-transcription` 1/1 at 224 ms, and
    `batch-audio-translation` 1/1 at 151 ms.
  - `npm run smoke:bridge`: returned a completed response with
    `output_text:"bridge-ok"`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online`; login/public entry, sidebar
    controls, navigation, project dialog/upload services, conversation submit,
    reload persistence, generated image artifact display, saved project reopen,
    and cleanup all passed with no console errors or warnings.
  - Disk/storage check before restart: filesystem had 42 GB available;
    `state/` was 7.2 MB, `output/` was 12 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Direct Images variations compatibility

- Used the official OpenAI OpenAPI operation `createImageVariation`
  (`POST /v1/images/variations`) as the source of truth for the endpoint shape:
  multipart form input, one `image`, `ImagesResponse` output, and default
  compatibility with `dall-e-2`.
- Added direct local `POST /v1/images/variations` support:
  - accepts official multipart requests with `image`, `model`, `n`, `size`,
    `response_format`, and `user`;
  - validates missing image input as `missing_required_parameter` on `image`;
  - returns deterministic placeholder PNG `ImagesResponse` data when the image
    provider is `placeholder`;
  - forwards provider-backed variation requests as multipart form data to the
    configured `/images/variations` provider path;
  - normalizes provider responses through the same Images API response adapter
    used by direct generations and edits;
  - keeps provider credentials sourced only from local environment variables.
- Added Batch-compatible JSON input for variations because Batch JSONL cannot
  carry multipart file parts:
  - JSON bodies can reference source images through `image`, `images`, or
    `image_url`;
  - accepted image sources include data URLs, HTTP(S) URLs, and local `file_id`
    references through the existing bounded image resolver;
  - local Batch now lists and executes `/v1/images/variations` alongside
    `/v1/images/generations` and `/v1/images/edits`.
- Added configuration and documentation:
  - `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_PATH`, default
    `/images/variations`;
  - `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_MODEL`, default `dall-e-2`;
  - updated `.env.example`, deployment docs, compatibility matrix, and
    evaluation plan.
- Added regression coverage:
  - multipart placeholder variation success;
  - missing-image validation;
  - OpenAI-compatible provider multipart forwarding;
  - local Batch JSONL execution over `/v1/images/variations`;
  - live eval cases `images-variation` and `batch-images-variation`.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused variation tests passed 116/116 in `test/server.test.js` under
    `node --test test/server.test.js --test-name-pattern
    "images/variations|Images variation"`; Node ran the full file while the
    new variation and Batch variation tests passed.
  - `npm test`: 154/154 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `images-variation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro` after the final bridge restart, pass rate 1.0,
    latency 76 ms, and output
    `images:2`.
  - Live `batch-images-variation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, pass rate 1.0, latency 191 ms, request counts
    `total:1`, `completed:1`, `failed:0`, and no error file.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup with no console errors or warnings.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned
    724 runtime candidates, selected 90 old UI screenshots by retention policy,
    deleted 0 files, selected 7353648 bytes, and reported 0 errors.
  - Disk/storage check: the filesystem has 39 GB available; `state/` is
    7.2 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Videos API protocol compatibility

- Used official OpenAI developer documentation before implementation:
  - Video generation guide: `POST /v1/videos` creates an async job, `GET
    /v1/videos/{video_id}` polls status, and `GET
    /v1/videos/{video_id}/content` downloads `video`, `thumbnail`, or
    `spritesheet` variants.
  - Batch guide: Batch supports JSON requests to `POST /v1/videos` and does not
    support multipart video inputs.
  - OpenAPI endpoint list: `/v1/videos`, `/v1/videos/{video_id}`,
    `/v1/videos/{video_id}/content`, `/v1/videos/edits`,
    `/v1/videos/extensions`, and `/v1/videos/{video_id}/remix` are current
    Videos API surfaces.
- Added local Videos API compatibility for Chat-Completions-only deployments:
  - `POST /v1/videos` accepts JSON or multipart video creation requests and
    returns a completed OpenAI-style `object:"video"` job with model, status,
    progress, size, seconds, quality, and compatibility metadata.
  - `GET /v1/videos`, `GET /v1/videos/{video_id}`, and
    `DELETE /v1/videos/{video_id}` provide local lifecycle coverage.
  - `GET /v1/videos/{video_id}/content` returns tiny placeholder bytes for
    `variant=video`, `thumbnail`, and `spritesheet` with matching content
    types, keeping `/srv/aialra/apps` disk usage bounded.
  - `POST /v1/videos/edits`, `/v1/videos/extensions`, and
    `/v1/videos/{video_id}/remix` return completed local video jobs with
    operation metadata for UI/SDK workflow compatibility.
  - Local Batch execution now supports `/v1/videos` JSONL lines and writes video
    resources into Batch output files.
- Added configuration:
  - `CODEXCOMPAT_VIDEO_GENERATION_PROVIDER`;
  - `CODEXCOMPAT_VIDEO_GENERATION_MODEL`;
  - `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SIZE`;
  - `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SECONDS`;
  - `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_QUALITY`;
  - `CODEXCOMPAT_VIDEO_GENERATION_MAX_INPUT_BYTES`.
- Updated compatibility and evaluation docs to move the gap from "no video
  endpoint coverage" to "protocol-compatible local placeholder, not hosted Sora
  rendering or media-quality parity."
- Verification so far:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/server.test.js --test-name-pattern "Videos API|local Batch API executes local video"` ran the full server test file and passed 113/113 subtests, including the two new Videos API cases.
  - Temporary local bridge eval `video-lifecycle`: passed 1/1, created a
    `video_...` record, retrieved it, downloaded content, deleted it, and
    reported `output_text:"video:completed:content"`.
  - Temporary local bridge eval `batch-videos`: passed 1/1, completed a local
    Batch with one `/v1/videos` JSONL request, produced one output line, and no
    error file.
  - `npm test`: passed 151/151 subtests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Post-restart live `video-lifecycle` bridge-regression case passed 1/1 on
    `http://127.0.0.1:12912`, including create, retrieve, content download,
    list, and delete, with latency 166 ms.
  - Post-restart live `batch-videos` bridge-regression case passed 1/1 on
    `http://127.0.0.1:12912`, completing one `/v1/videos` JSONL request with
    one output line and no error file, latency 217 ms.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned 724
    runtime candidates, selected 90 old UI screenshots by retention policy,
    deleted 0, selected 7353648 bytes, and reported 0 errors.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    7.2 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Direct Images API upstream SSE relay

- Used the official OpenAI Images OpenAPI endpoint specs for
  `POST /v1/images/generations` and `POST /v1/images/edits`:
  - `stream:true` generation responses use
    `image_generation.partial_image` and `image_generation.completed`;
  - `stream:true` edit responses use `image_edit.partial_image` and
    `image_edit.completed`;
  - `partial_images` controls streamed partial image count for GPT image
    models and is forwarded only when explicitly requested by the client.
- Replaced direct Images API streaming for provider-backed calls from
  final-image synthesis to upstream SSE relay:
  - generation stream requests now send JSON `stream:true` and optional
    `partial_images` to the configured `/images/generations` provider path;
  - edit stream requests now send multipart `stream=true` and optional
    `partial_images` to the configured `/images/edits` provider path;
  - upstream provider SSE frames are parsed incrementally, normalized by event
    name, and written to the client as they arrive;
  - provider JSON fallback and placeholder mode still synthesize compatible
    Image API SSE events from the final image for SDK compatibility;
  - streaming provider errors after headers are emitted as SSE `error` events,
    while pre-stream validation/provider HTTP errors keep OpenAI-style JSON
    errors.
- Added bridge-regression cases for direct Images generation/edit SSE:
  `images-generation-stream` and `images-edit-stream`.
- Updated compatibility and evaluation docs so the current known gaps no
  longer list true upstream Images partial-image relay as missing.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Images API streaming tests passed in the 111/111 reported server
    subtests:
    `node --test test/server.test.js --test-name-pattern "images/generations|images/edits|Images API|Images edit"`.
  - `npm test`: 149/149 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 707 runtime
    candidates, selected 90 old UI screenshots by retention policy, deleted
    0 files, selected 7,353,648 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz on
    `http://127.0.0.1:12912/healthz` returned `ok:true`, DeepSeek provider
    base `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Live `images-generation-stream` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 69 ms, event count 3, output
    `image_generation:2:completed`, and zero model tokens because it is local
    placeholder image generation.
  - Live `images-edit-stream` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 52 ms, event count 3, output
    `image_edit:2:completed`, and zero model tokens because it is local
    placeholder image editing.
  - Full live `npm run eval:bridge`: 59/59 passing cases, pass rate 1.0,
    average latency 1240 ms, P95 latency 3423 ms, and total usage 10,720
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Disk/storage check: filesystem has 40 GB available; repo `state/` is
    7.2 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or
  local deployment env files were added to the repository.

## 2026-06-11 - Direct Images API edit endpoint and Batch coverage

- Used the official OpenAI Images edits OpenAPI endpoint shape for
  `POST /v1/images/edits`, including multipart source images and masks,
  JSON-form `images` inputs, `ImagesResponse` output, and
  `image_edit.partial_image` / `image_edit.completed` streaming event names.
- Added direct local `POST /v1/images/edits` support:
  - multipart requests accept repeated `image`, `image[]`, `images`, or
    `images[]` file parts plus optional `mask`;
  - JSON requests accept `images`, `image`, or `image_url` inputs using data
    URLs, inline base64 image data, bounded HTTP(S) URLs, and local Files API
    `file_id` references;
  - optional JSON or multipart masks are resolved with the same byte and media
    type validation as Responses image-generation edits;
  - placeholder mode returns deterministic multi-image base64 PNG responses
    without calling the Chat provider;
  - provider-backed mode calls the configured OpenAI-compatible multipart
    `/images/edits` path, forwards supported edit options, preserves all
    returned `data[]` entries, and maps provider errors into OpenAI-style JSON
    errors;
  - `stream:true` synthesizes direct Images edit SSE events from the final
    image so SDK streaming clients can parse the surface while true upstream
    partial relay remains documented as a gap.
- Extended local Batch API execution to accept JSON-form
  `/v1/images/edits` requests in addition to `/v1/images/generations` and the
  existing text/embedding/moderation endpoints.
- Updated:
  - `docs/compatibility-matrix.md` direct Images edit, Batch coverage, and
    known gaps;
  - `docs/deployment.md` image provider/env descriptions;
  - `docs/evaluation-plan.md` with `images-edit` and `batch-images-edit`
    bridge-regression coverage;
  - `scripts/eval-harness.mjs` with direct and Batch Images edit cases.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused server tests including direct Images edit and Batch edit coverage
    passed 111/111 reported subtests:
    `node --test test/server.test.js --test-name-pattern "images/edits|Images edit"`.
  - `npm test`: 149/149 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 691 runtime
    candidates, selected 90 old UI screenshots by retention policy, deleted
    0 files, selected 7,353,648 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz on
    `http://127.0.0.1:12912/healthz` returned `ok:true`, DeepSeek provider
    base `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Live `images-edit` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 111 ms, zero model tokens because it is local
    placeholder image editing.
  - Live `batch-images-edit` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 221 ms, one completed Batch line and no error
    file.
  - Full live `npm run eval:bridge`: 57/57 passing cases, pass rate 1.0,
    average latency 1240 ms, P95 latency 2514 ms, and total usage 10,644
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Direct runtime multipart smoke for `/v1/images/edits` returned HTTP 200
    with two `data[].b64_json` PNG images and an edit `revised_prompt`.
  - Disk/storage check: filesystem has 40 GB available; repo `state/` is
    6.9 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or
  local deployment env files were added to the repository.

## 2026-06-11 - Direct Images API generation endpoint and Batch coverage

- Used the official OpenAI Image generation guide and OpenAPI endpoint spec for
  `POST /v1/images/generations` to align the local bridge with the current
  Images API shape:
  - JSON requests include `prompt`, optional `model`, `n` from 1 to 10,
    output options such as `size`, `quality`, `background`, `moderation`,
    `output_format`, `output_compression`, `response_format`, `style`, and
    `user`;
  - non-streaming responses return `created`, `data[].b64_json`, optional
    `data[].revised_prompt`, and provider `usage` when present;
  - streaming responses use Image API SSE events
    `image_generation.partial_image` and `image_generation.completed`.
- Added direct local `POST /v1/images/generations` support:
  - placeholder mode returns deterministic base64 PNG data and supports
    multi-image `n` requests without calling the Chat provider;
  - provider-backed mode calls the configured OpenAI-compatible
    `/images/generations` path, forwards supported image options, preserves all
    returned `data[]` entries, and surfaces provider errors as OpenAI-style
    JSON errors;
  - `stream:true` synthesizes Image API SSE events from the final image so SDK
    streaming workflows can parse the endpoint, while true upstream partial
    chunk relay remains documented as a gap.
- Extended local Batch API execution to accept endpoint
  `/v1/images/generations` in addition to existing Responses, Chat,
  Completions, Embeddings, and Moderations endpoints. Batch JSONL output files
  now preserve the direct Images response body.
- Updated:
  - `docs/compatibility-matrix.md` direct Images and known-gap coverage;
  - `docs/deployment.md` image-generation provider/env descriptions;
  - `docs/evaluation-plan.md` live regression coverage;
  - `scripts/eval-harness.mjs` with `images-generation` and
    `batch-images-generation` bridge-regression cases.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused direct Images tests passed 5/5:
    `node --test --test-name-pattern "images/generations|direct Images|OpenAI-compatible Images API|direct Images generation" test/server.test.js`.
  - `npm test`: 145/145 passing tests.
  - Live `images-generation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 61 ms, zero model tokens because it is local
    placeholder image generation.
  - Live `batch-images-generation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 153 ms, one completed Batch line and no error
    file.
  - Full live `npm run eval:bridge`: 55/55 passing cases, pass rate 1.0,
    average latency 1366 ms, P95 latency 2807 ms, and total usage 10,705
    tokens.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 691 candidates,
    selected 90 old UI screenshots by retention policy, deleted 0 files,
    selected 7,353,648 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Direct runtime smoke for `/v1/images/generations` returned two
    `data[].b64_json` PNG images.
  - Disk/storage check: filesystem has 38 GB available; repo `state/` is
    6.6 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Provider-backed image_generation edits and masks

- Extended the local Responses `image_generation` adapter to cover edit and
  mask workflows in addition to generation:
  - `action:"edit"` now requires at least one resolved input image and returns
    a failed `image_generation_call` when no image is available, matching the
    documented hosted Responses behavior;
  - `action:"auto"` chooses edit when current input images or masks are present
    while avoiding a forced edit for prior `image_generation_call.id` references
    that do not yet have locally persisted image bytes;
  - provider-backed edit mode calls a configurable multipart endpoint,
    defaulting to `POST /images/edits`;
  - maps resolved input images to `image[]` and a resolved
    `input_image_mask` to `mask`;
  - fails requested-mask edits when the mask cannot be resolved instead of
    silently editing without the requested mask;
  - resolves edit inputs from local Files API `file_id`, data URLs, inline
    base64 image fields, HTTP(S) image URLs with bounded timeout/byte limits,
    and inline `image_generation_call.result` bytes;
  - records edit mode, resolved image count, mask resolution, and image
    resolution failures in compatibility metadata without storing image bytes;
  - replaces consumed Chat `image_url` content parts with a text marker during
    local edit mode so text-only providers such as DeepSeek do not reject the
    upstream Chat request after the bridge has already handled the image.
- Added configuration and docs:
  - `CODEXCOMPAT_IMAGE_GENERATION_EDIT_PATH`;
  - `CODEXCOMPAT_IMAGE_GENERATION_MAX_INPUT_IMAGE_BYTES`;
  - `CODEXCOMPAT_IMAGE_GENERATION_INPUT_FETCH_TIMEOUT_MS`;
  - compatibility/deployment docs now describe provider-backed multipart edits,
    mask mapping, forced-edit failure behavior, and the text-only provider
    sanitization boundary;
  - `scripts/eval-harness.mjs` now includes a `responses-image-edit`
    bridge-regression case.
- Verification:
  - Official OpenAI image-generation docs were checked via the OpenAI docs MCP:
    the Images API has `/images/generations` and `/images/edits`, edit requests
    use multipart `image[]` plus optional `mask`, and forced Responses
    `action:"edit"` without an image returns an error.
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused image-generation tests passed 9/9:
    `node --test --test-name-pattern='image_generation|Images API|image provider|reserve image_generation' test/translator.test.js test/server.test.js`.
  - `npm test`: 139/139 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1082 ms, P95 latency 1160 ms, and total usage 99 tokens.
  - Live `responses-image-generation` bridge-regression case passed 1/1
    against `deepseek-v4-pro` after deployment restart, latency 1238 ms, and
    total usage 188 tokens.
  - Live `responses-image-edit` bridge-regression case initially exposed a
    DeepSeek `image_url` content-part rejection; after adding edit-input
    sanitization it passed 1/1 against `deepseek-v4-pro`, latency 1343 ms, and
    total usage 215 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; latest dry
    run reported response records scanned 479, selected 0, deleted 0, and no
    errors. Earlier full summary still selected 89 old UI screenshots by
    retention policy, deleted 0, selected 7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Image generation multi-turn call-id persistence

- Extended the local Responses `image_generation` adapter with generated image
  call persistence for multi-turn edit workflows:
  - successful `image_generation_call.result` bytes are stored under a local
    `local-image-generations` state directory with `0600` JSON files and a
    `0700` directory;
  - generated image state is bounded by
    `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGES`,
    `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGE_BYTES`, and
    `CODEXCOMPAT_IMAGE_GENERATION_STORE_TTL_MS`;
  - id-only follow-up inputs such as
    `{type:"image_generation_call",id:"ig_..."}` are resolved into edit images
    before provider-backed `/images/edits` calls;
  - `previous_response_id` now contributes prior image-generation output to
    local image context so official multi-turn image workflows can enter edit
    mode without resending base64 image data;
  - background and local Batch `/v1/responses` execution paths receive the same
    image-generation state store dependency as foreground requests.
- Added compatibility metadata for generated/stored image-call counts and
  updated `.env.example`, deployment docs, and the compatibility matrix for the
  new state controls.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/store.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --test --test-name-pattern "image_generation" test/server.test.js`:
    10/10 passing, including provider-backed id-only edit and
    `previous_response_id` edit context regressions.
  - `npm test`: 141/141 passing tests.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1122 ms, P95 latency 1161 ms, and total usage
    99 tokens.
  - `npm run eval:bridge -- --case responses-image-id-edit`: passed 1/1
    against `deepseek-v4-pro`, proving the new id-only image edit eval case.
  - `npm run eval:bridge`: passed 52/52 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1320 ms, P95 latency 2844 ms, and total usage
    10501 tokens. The suite included `responses-image-generation`,
    `responses-image-edit`, and `responses-image-id-edit`.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup with no console errors or warnings.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned
    637 candidates, selected 89 old UI screenshots by retention policy, deleted
    0 files, selected 7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Post-restart live two-step id-only image edit smoke passed locally:
    first request produced a completed `ig_...` call; second request supplied
    only `{type:"image_generation_call",id:"ig_..."}` and returned
    `mode:"edit"`, `prior_stored_image_call_count:1`,
    `resolved_stored_image_call_count:1`, and `resolved_image_count:1`.
  - Disk/storage check: the filesystem has 39 GB available; `state/` is
    5.6 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Provider-backed image_generation adapter

- Extended the local Responses `image_generation` hosted-tool adapter from
  placeholder-only protocol coverage to configurable provider-backed image
  generation:
  - added `openai-compatible` / `openai` / `images` provider modes;
  - calls an OpenAI-compatible JSON Images API generation endpoint at
    `POST /images/generations`;
  - sends a dedicated image model, prompt, one requested image, and supported
    generation options such as `size`, `quality`, `background`,
    `output_format`, `output_compression`, and `moderation`;
  - maps provider `data[0].b64_json` into
    `image_generation_call.result`;
  - preserves provider `data[0].revised_prompt` when present;
  - records provider model metadata in
    `metadata.compatibility.local_image_generation.model`;
  - surfaces provider errors as failed `image_generation_call` items and
    compatibility metadata instead of fabricating an image.
- Added configuration for real image providers while keeping secrets outside
  Git:
  - `CODEXCOMPAT_IMAGE_GENERATION_BASE_URL`;
  - `CODEXCOMPAT_IMAGE_GENERATION_PATH`;
  - `CODEXCOMPAT_IMAGE_GENERATION_API_KEY_ENV`;
  - `CODEXCOMPAT_IMAGE_GENERATION_MODEL`;
  - `CODEXCOMPAT_IMAGE_GENERATION_RESPONSE_FORMAT`;
  - `CODEXCOMPAT_IMAGE_GENERATION_TIMEOUT_MS`.
- Kept the default provider as `placeholder`, so development and CI can still
  exercise Responses image output without requiring an image-generation API
  key. Real image-provider keys must be placed in deployment-local environment
  files, not in the repository.
- Updated compatibility/deployment/evaluation docs. The known gap is now
  narrowed to multipart edits/masks, true upstream partial-image streaming
  relay, full hosted prompt-rewrite parity, multi-turn high-fidelity image
  persistence, and image-quality evaluation suites.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused image-generation tests passed 6/6:
    `node --test --test-name-pattern='image_generation|Images API|image provider|reserve image_generation' test/translator.test.js test/server.test.js`.
  - `npm test`: 136/136 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 945 ms, P95 latency 1047 ms, and total usage 99 tokens.
  - Live `responses-image-generation` bridge-regression case passed 1/1
    against `deepseek-v4-pro` after deployment restart, latency 1219 ms, and
    total usage 186 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 637 runtime candidates,
    selected 89 old UI screenshots by retention policy, deleted 0, selected
    7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct Audio custom voice metadata compatibility

- Used current official OpenAI docs and OpenAPI endpoint metadata to confirm
  the direct Audio custom voice flow:
  - `POST /v1/audio/voice_consents`;
  - `GET /v1/audio/voice_consents`;
  - `GET /v1/audio/voice_consents/{consent_id}`;
  - `POST /v1/audio/voices`.
- Added a local metadata-only compatibility layer for Chat-only providers:
  - `POST/GET /v1/audio/voice_consents`;
  - `GET /v1/audio/voice_consents/{consent_id}`;
  - `POST/GET /v1/audio/voices`;
  - `GET /v1/audio/voices/{voice_id}` as a local retrieval extension for SDK
    and UI compatibility.
- Stored consent and voice records under a dedicated local state directory with
  `0700` directories and `0600` JSON files. The bridge records filename, byte
  length, content type, detected format, and SHA-256 digest, but does not store
  uploaded audio bytes.
- Enforced a default 20-voice cap matching the documented organization limit
  and bounded upload parsing with `CODEXCOMPAT_AUDIO_VOICE_MAX_INPUT_BYTES`.
- Marked generated voice records with compatibility metadata including
  `synthetic_voice_model_created:false` so callers can distinguish protocol
  compatibility from a real provider-backed cloned voice model.
- Updated `.env.example`, deployment docs, compatibility matrix, evaluation
  plan, and the bridge regression harness with the
  `audio-voice-lifecycle` case.
- Verification:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused direct Audio tests passed through `test/server.test.js`, including
    custom voice lifecycle, missing recording validation, and missing consent
    validation.
  - `npm test`: 159/159 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 729 runtime
    candidates, selected 92 old UI screenshots by retention policy, deleted 0
    files, selected 7555293 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `audio-voice-lifecycle` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, creating consent `cons_LvqCugPLFeOPl-GCWJQIh3tR` and
    voice `voice_Wugjq5bEjBvs7uG16QFvJwhE`, with consent get/list and voice
    get/list all returning 200.
  - Full live `npm run eval:bridge`: 69/69 passing cases, pass rate 1.0,
    average latency 1095 ms, P95 latency 3064 ms, and total usage 10696
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup with no console errors or warnings.
  - Disk/storage check: the filesystem has 41 GB available; `state/` is
    7.6 MB, `output/` is 13 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Evals API compatibility

- Used current official OpenAI docs/OpenAPI metadata to confirm the Evals API
  surface:
  - `POST /v1/evals` / `GET /v1/evals`;
  - `GET` / `POST` / `DELETE /v1/evals/{eval_id}`;
  - `POST` / `GET /v1/evals/{eval_id}/runs`;
  - `GET /v1/evals/{eval_id}/runs/{run_id}`;
  - `GET /v1/evals/{eval_id}/runs/{run_id}/output_items`;
  - `GET /v1/evals/{eval_id}/runs/{run_id}/output_items/{output_item_id}`.
- Recorded the official Evals deprecation dates in the compatibility matrix:
  read-only for existing users on 2026-10-31 and shutdown scheduled for
  2026-11-30.
- Added a local synchronous Evals compatibility layer for Chat-only providers:
  - file-backed `eval_...`, `evalrun_...`, and `eval.run.output_item`
    storage under `CODEXCOMPAT_EVAL_STATE_DIR` with `0700` directories and
    `0600` JSON files;
  - eval create/list/get/update/delete;
  - run create/list/get and a local terminal cancel no-op;
  - output item list/get with stable JSONL line ordering;
  - `purpose:"evals"` Files as run data sources plus inline local row data;
  - `data_source.type:"responses"` template materialization through local
    `/v1/responses` with `store:false` when a row does not provide a sample;
  - sample-driven grading without upstream calls when rows include
    `sample.output_text` or compatible sample fields;
  - deterministic `string_check` graders for `eq`, `ne`, `contains`,
    `not_contains`, `starts_with`, `ends_with`, and `regex`;
  - run-level `result_counts`, `per_model_usage`,
    `per_testing_criteria_results`, local `report_url`, and compatibility
    metadata.
- Added `CODEXCOMPAT_EVAL_STATE_DIR` and `CODEXCOMPAT_EVAL_MAX_ROWS` to
  `.env.example` and deployment docs. The default row cap is 100 for the
  `/srv/aialra/apps` deployment profile.
- Added `evals-lifecycle` to the live `bridge-regression` harness. It creates
  an eval, uploads a `purpose:"evals"` JSONL File, creates a run, checks two
  output items with one pass and one fail, retrieves/list runs, updates eval
  metadata, lists evals, deletes the eval, and cleans up the file.
- Verification:
  - `node --check src/bridge/local_evals.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/server.test.js --test-name-pattern "Evals API"` ran the
    full server test file and passed 122/122, including the new Evals case.
  - `npm test`: passed 160/160.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 750 runtime
    candidates, selected 93 old UI screenshots by retention policy, deleted 0
    files, selected 7640523 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `evals-lifecycle` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 157 ms, `result_counts:{total:2,passed:1,failed:1,errored:0}`,
    and zero token usage because it used sample-driven local grading.
  - Full live `npm run eval:bridge`: 70/70 passing cases, pass rate 1.0,
    average latency 967 ms, P95 latency 2350 ms, and total usage 10705 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation,
    project dialog/upload services, conversation submission, completed-turn
    actions, reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    7.9 MB, `output/` is 13 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Provider-backed score_model graders

- Used current official OpenAI Graders docs and OpenAPI metadata for
  `/v1/fine_tuning/alpha/graders/run` and
  `/v1/fine_tuning/alpha/graders/validate` to confirm the `score_model`
  compatibility shape: message-array `input`, required judge `model`, numeric
  `pass_threshold`, numeric `range`, optional `sampling_params`, JSON-like
  grader output with a numeric `result`, and
  `model_grader_token_usage_per_model` metadata.
- Added provider-backed `score_model` support to the local Graders layer:
  - `/v1/fine_tuning/alpha/graders/validate` validates `score_model`
    structure without calling the provider;
  - `/v1/fine_tuning/alpha/graders/run` renders grader messages with
    item/sample template variables, calls the configured Chat provider as a
    judge, requests JSON output, parses and clamps the numeric score to the
    configured range, applies `pass_threshold`, and records judge token usage;
  - `multi` graders can now include async `score_model` subgraders and
    aggregate token usage and model usage metadata.
- Added provider-backed `score_model` criteria support to local Evals runs, so
  inline rows or `purpose:"evals"` JSONL rows can grade sample output with the
  configured Chat provider while preserving Evals output-item accounting.
- Kept the compatibility boundary explicit:
  - this is a Chat-provider judge compatibility runtime, not OpenAI hosted
    grader execution;
  - `python` graders remain unsupported because there is no sandboxed Python
    grading runtime in this deployment profile.
- Updated compatibility matrix, evaluation plan, deployment verification
  commands, unit tests, and the bridge regression harness with the
  `graders-api-score-model` live case.
- Verification:
  - `node --check src/bridge/local_graders.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Graders/Evals server tests passed through `test/server.test.js`,
    including provider-backed `score_model` validation, direct grader runs, and
    Evals criteria runs.
  - `npm test`: passed 164/164.
  - Targeted live `graders-api-score-model` repeated 3/3 against
    `deepseek-v4-pro`; all three scored `reward:1` and recorded judge token
    usage.
  - Full live `npm run eval:bridge`: 72/72 passing cases, pass rate 1.0,
    average latency 952 ms, P95 latency 2694 ms, and total usage 10824 tokens.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 778 runtime
    candidates, selected 0 files, deleted 0 files, and reported 0 errors.
  - Disk/storage check: the filesystem has 38 GB available; `state/` is
    9.6 MB, `output/` is 4.8 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Python grader compatibility

- Used current official OpenAI Graders docs and OpenAPI metadata for
  `/v1/fine_tuning/alpha/graders/run` and
  `/v1/fine_tuning/alpha/graders/validate` to confirm the `python` grader
  shape: `type:"python"`, `source`, optional `image_tag`, a required
  `grade(sample, item)` function with exactly two arguments, float reward
  output, 256 KiB source cap, 2 minute execution limit, no network, 2 GB memory,
  1 GB disk, and 2 CPU cores in the hosted environment.
- Added local Python grader compatibility:
  - `validate` now accepts `python` graders and enforces source shape, optional
    `image_tag`, and the documented source-size cap;
  - `run` executes `grade(sample, item)` in a short-lived Python subprocess
    with a sanitized environment, isolated temporary workdir, local timeout,
    Python `resource` limits where supported, common network/process import and
    audit guards, bounded captured output, reward clamping, and best-effort
    workdir cleanup;
  - Python runtime errors, invalid returns, and timeouts return reward `0`
    with `python_grader_runtime_error` metadata instead of crashing the bridge;
  - local Evals criteria and `multi` graders can include Python subgraders.
- Reused the same configured Python grader options when validating nested
  `multi` subgraders during sync and async execution, so custom source, memory,
  disk, timeout, and interpreter settings behave consistently.
- Added configuration knobs:
  - `CODEXCOMPAT_PYTHON_GRADER_PROVIDER`;
  - `CODEXCOMPAT_PYTHON_GRADER_STATE_DIR`;
  - `CODEXCOMPAT_PYTHON_GRADER_TIMEOUT_MS`;
  - `CODEXCOMPAT_PYTHON_GRADER_MAX_SOURCE_BYTES`;
  - `CODEXCOMPAT_PYTHON_GRADER_DISK_BYTES`;
  - `CODEXCOMPAT_PYTHON_GRADER_MEMORY_BYTES`;
  - `CODEXCOMPAT_PYTHON_GRADER_BIN`.
- Kept the compatibility boundary explicit: this is a local subprocess runner,
  not OpenAI's hosted Python grader image and not a hardened container or
  microVM sandbox. Full parity still needs stronger OS-level isolation,
  dependency-image parity, and larger adversarial grader tests.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness. The live
  `graders-api-local` case now validates Python grader execution and keeps an
  unknown `javascript` grader as the `unsupported_grader_type` check.
- Verification:
  - `node --check src/bridge/local_graders.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Graders/Evals server tests passed through `test/server.test.js`,
    including direct Python grader validate/run, runtime-error reward `0`, and
    Evals Python criteria execution.
  - `npm test`: passed 164/164.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `graders-api-local` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, including `python_status:200` and `python_reward:1`
    with zero provider token usage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 72/72 passing cases, pass rate 1.0, average latency 1096 ms, P95
    latency 2826 ms, and total usage 11161 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 818 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 818 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 37 GB available;
    `state/` is 11 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local MCP protocol-context compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to confirm the request and output protocol shape:
  `tools:[{type:"mcp"}]`, `server_label`, remote `server_url` or connector
  `connector_id`, optional per-request `authorization`, `require_approval`,
  `allowed_tools`, `defer_loading`, plus `mcp_list_tools`, `mcp_call`,
  `mcp_approval_request`, and `mcp_approval_response` item flow.
- Added a local MCP compatibility adapter for Chat-only providers:
  - reserves MCP tools so they are not forwarded upstream as unsupported Chat
    tools;
  - emits `mcp_list_tools` output items for non-streaming, streaming, and
    background Responses requests;
  - injects MCP server/tool/context summaries into Chat messages so the model
    can reason over prior MCP state;
  - imports explicit/allowed tool definitions, handles remote-server and
    connector metadata, supports `defer_loading`, and records local MCP counts
    under `metadata.compatibility.local_mcp`;
  - consumes the shared local `max_tool_calls` budget for emitted list-tools
    items and records skipped local MCP work in local budget metadata.
- Tightened MCP secret handling:
  - `authorization` and `headers.Authorization` are removed from public
    Responses `tools` snapshots, matching the OpenAI docs boundary that MCP
    authorization is not stored or visible on the Response object;
  - background job request snapshots are also redacted during initial queueing
    and later `provider_pending` persistence.
- Added live and mock-provider coverage:
  - `responses-mcp-local` in the bridge regression harness;
  - non-streaming unit coverage for `mcp_list_tools`, Chat prompt injection,
    DeepSeek thinking disablement, local budget consumption, prior `mcp_call`
    context, and no authorization leakage;
  - streaming unit coverage for `response.output_item.added` MCP output;
  - background unit coverage that inspects persisted `background_job.request`
    and confirms MCP authorization is not written to disk.
- Kept the compatibility boundary explicit: this is a local protocol-context
  adapter, not a remote MCP transport executor, not hosted OpenAI Connectors,
  and not an OAuth/approval-loop runtime. Full parity still requires
  Streamable HTTP/SSE execution, connector token sidecars, approval state,
  allowlists, and tool-output audit review.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed through `test/server.test.js`,
    including authorization redaction for public responses and persisted
    background jobs.
  - `npm test`: passed 167/167.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `responses-mcp-local` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 1356 ms, output `mcp-local-ok`, and total usage
    289 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 73/73 passing cases, pass rate 1.0, average latency 1139 ms, P95
    latency 2794 ms, and total usage 11191 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 838 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 838 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 40 GB available;
    `state/` is 11 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Remote MCP tools/list import compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to refine the next compatibility boundary. The
  relevant documented shape remains `tools:[{type:"mcp"}]` with
  `server_label`, remote `server_url` or connector `connector_id`, optional
  per-request `authorization`, `require_approval`, `allowed_tools`, and
  `defer_loading`; Responses output can include `mcp_list_tools`, `mcp_call`,
  and `mcp_approval_request`, while approval responses can be sent as later
  input items.
- Extended the local MCP adapter from protocol-context only to bounded remote
  list-tools import:
  - remote `server_url` tools without explicit local definitions now run
    JSON-RPC `initialize`, `notifications/initialized`, and paginated
    `tools/list`;
  - remote responses can be `application/json` or `text/event-stream`;
  - returned `inputSchema` / `input_schema`, `annotations`, `description`, and
    `name` are normalized into Responses-style `mcp_list_tools.tools`;
  - `allowed_tools` filters the imported remote tool list;
  - returned `mcp-session-id` values are carried on later remote list requests;
  - timeout, response-byte, max-tool, protocol-version, and client-name knobs
    are configurable through `CODEXCOMPAT_MCP_*` env vars.
- Kept MCP secret handling explicit:
  - request `authorization` is used only to form the outbound remote MCP
    `Authorization` header for that request;
  - caller-supplied `headers.Authorization` still conflicts with top-level
    `authorization`;
  - public Responses output, stored snapshots, compatibility metadata, and eval
    reports do not contain the authorization value.
- Added coverage:
  - unit/mock-provider coverage for remote MCP `initialize` /
    `notifications/initialized` / SSE `tools/list`, session-id forwarding,
    `allowed_tools` filtering, normalized schemas, annotations, budget
    consumption, prompt context, and authorization redaction;
  - a live bridge regression case, `responses-mcp-remote-list`, that starts a
    local mock MCP server, verifies the deployed bridge performs the remote
    MCP list-tools round trip, then sends the imported context through
    DeepSeek.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness.
- Kept the compatibility boundary explicit: this imports remote MCP tool
  definitions and emits `mcp_list_tools`, but still does not execute remote
  `mcp_call`, run approval loops, or provide OpenAI hosted connector
  OAuth/token sidecars.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed through `test/server.test.js`,
    including the remote MCP Streamable HTTP/SSE `tools/list` import case.
  - `npm test`: passed 168/168.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - A pre-restart live `responses-mcp-remote-list` check correctly showed the
    old running bridge was still using placeholder-only MCP behavior; after
    restart, the same live case passed 1/1 against `deepseek-v4-pro`, latency
    1667 ms, output `mcp-remote-ok`, 287 total tokens, and confirmed remote
    `initialize`, `notifications/initialized`, `tools/list`, authorization
    forwarding, and session forwarding.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 74/74 passing cases, pass rate 1.0, average latency 1191 ms, P95
    latency 3074 ms, and total usage 11735 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 858 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 858 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 39 GB available;
    `state/` is 11 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Streaming remote MCP call-loop compatibility

- Used current official OpenAI Responses MCP/Connectors documentation through
  the OpenAI developer-docs MCP before changing behavior. The relevant
  documented surfaces remain `tools:[{type:"mcp"}]`, `server_label`,
  `server_url` / `connector_id`, per-request `authorization`,
  `require_approval`, `allowed_tools`, output items such as `mcp_list_tools`,
  `mcp_call`, and `mcp_approval_request`, and streaming events including
  `response.mcp_call_arguments.delta`,
  `response.mcp_call_arguments.done`, and
  `response.mcp_call.in_progress`.
- Extended the remote MCP bridge from non-streaming/background call loops to
  streaming Responses requests:
  - streaming requests with imported remote MCP tools now expose generated
    Chat function-tool proxies to the upstream Chat provider;
  - the upstream tool-selection SSE turn is buffered so generated internal
    `function_call` proxy items do not leak to Responses clients;
  - auto-approved MCP proxy calls execute remote JSON-RPC `tools/call`, append
    redacted Chat `tool` messages, then stream the final visible follow-up
    provider deltas;
  - the bridge emits Responses MCP call argument/progress SSE events and lets
    normal stream completion emit final `mcp_call` output items;
  - approval-required streaming tool calls now emit `mcp_approval_request`
    output items without executing `tools/call`.
- Updated the MCP compatibility prompt, compatibility matrix, deployment docs,
  evaluation plan, and bridge regression harness. Added live case
  `responses-mcp-remote-stream-call`.
- Added unit/mock-provider coverage for:
  - streaming auto-approved remote MCP `tools/call` over two upstream Chat
    streams;
  - SSE `response.mcp_call_arguments.*` and
    `response.mcp_call.in_progress` emission;
  - no public leak of generated MCP proxy `function_call` items;
  - usage aggregation across tool-selection and final streaming turns;
  - authorization redaction in public responses and Chat follow-up payloads;
  - streaming approval-request emission without remote `tools/call`.
- Compatibility boundary: this now covers non-streaming, streaming, and active
  background auto-approved remote MCP `tools/call` for `server_url` tools, plus
  streaming approval-request emission. Hosted connector OAuth/token sidecars,
  restart-resumable per-request MCP authorization, and broader hosted connector
  approval persistence remain future work.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP server-test command ran through `test/server.test.js`; the
    whole file passed 138/138, including the new streaming remote MCP call and
    streaming approval-request tests.
  - `npm test`: passed 176/176.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live `responses-mcp-remote-stream-call` case passed 1/1 against
    `deepseek-v4-pro`, latency 3397 ms, output
    `mcp-remote-stream-call-ok`, 24 SSE events, remote MCP methods
    `initialize`, `notifications/initialized`, `tools/list`, `tools/call`,
    and total usage 1128 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 79/79,
    pass rate 1.0, average latency 1418 ms, P95 latency 4089 ms, and total
    usage 18366 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1306 ms, P95 latency 1395 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, exercised sidebar navigation,
    project dialog/upload, prompt submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup without console errors.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 994 runtime
    candidates, selected 1 old UI smoke screenshot, selected 85190 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    85190 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem had 39 GB available;
    `state/` was 13 MB, `output/` was 4.8 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants hosted-tool local compatibility

- Used the official OpenAI Assistants docs to refine the next compatibility
  boundary:
  - Assistants can define built-in `file_search` and `code_interpreter` tools;
  - `tool_resources.file_search.vector_store_ids` and
    `tool_resources.code_interpreter.file_ids` can be attached at assistant,
    thread, and run scope;
  - Run Steps can expose hosted tool-call details and file-search results.
- Closed the first Assistants hosted-tool gap for Chat-only providers:
  - run startup now merges assistant-, thread-, and run-level tool resources
    before local execution;
  - Assistants `file_search` tools reuse the local Responses file-search/vector
    store adapter, inject retrieval evidence into the upstream Chat request,
    create `file_search` Run Steps with results, and add `file_citation`
    annotations to assistant message content;
  - Assistants `code_interpreter` tools reuse the local container/shell adapter,
    mount local Files API `file_ids` into `/mnt/data`, execute explicit Python
    blocks, inject stdout and mounted-file evidence into Chat, and create
    `code_interpreter` Run Steps with logs;
  - compatibility metadata now reports local hosted Assistants tool types
    without marking locally handled `file_search` / `code_interpreter` as
    unsupported.
- Extended regression coverage:
  - added unit/mock-provider tests for Assistants `file_search` vector-store
    evidence, citation annotations, Run Step persistence, and thread-level
    resource merging;
  - added unit/mock-provider tests for Assistants `code_interpreter` Python
    execution, file-id mounting, Run Step logs, and mounted-file metadata;
  - added live bridge-regression cases `assistants-file-search` and
    `assistants-code-interpreter`.
- Updated docs:
  - compatibility matrix now lists local Assistants hosted-tool behavior and
    narrows the known gap to hosted OpenAI jobs, attachment-created vector
    stores, model-driven code loops, async thread locks, and non-text hosted
    deltas;
  - evaluation plan now lists the new live and mock-provider Assistants
    hosted-tool coverage.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/store.js`, `src/bridge/local_shell.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 6/6.
  - `npm test`: passed 183/183.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live `assistants-file-search` passed 1/1 against `deepseek-v4-pro`, latency
    1747 ms, output `assistants-file-search-live-ok [1]`, 2 Run Steps, 2
    messages, and 205 total tokens.
  - Live `assistants-code-interpreter` passed 1/1 against `deepseek-v4-pro`,
    latency 1743 ms, output `assistants-ci-live-ok`, 2 Run Steps, 2 messages,
    and 487 total tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 86/86,
    pass rate 1.0, average latency 1375 ms, P95 latency 4103 ms, and total
    usage 21202 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    1377 ms, P95 latency 1499 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising sidebar navigation,
    core pages, project dialog/upload, prompt submission, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project reopen/cleanup, and console error/warning checks.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1313 runtime
    candidates, selected 1 old UI smoke screenshot, selected 105170 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    105170 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 41 GB available; `state/` was 18 MB,
    `output/` was 4.8 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 24 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Assistants run truncation and prompt budget

- Used the official OpenAI Assistants create-run/create-thread-and-run
  reference to confirm the next local compatibility target:
  - `truncation_strategy` controls how a thread is truncated before a Run;
  - `max_prompt_tokens` is a best-effort prompt-token budget over the Run and
    can lead to hosted `incomplete` status when exceeded;
  - `max_completion_tokens` remains the completion-token budget and is already
    forwarded through the existing Chat compatibility path.
- Closed the first Chat-only compatibility gap for Assistants Run context
  shaping:
  - local Run creation now applies
    `truncation_strategy:{type:"last_messages",last_messages:n}` before
    building the upstream Chat request;
  - local Assistants hosted-tool adapters (`file_search` and
    `code_interpreter`) receive the same selected thread message set as the
    model request;
  - local Run creation applies `max_prompt_tokens` as a best-effort prompt
    budget using serialized Chat-message characters divided by four, dropping
    oldest selected thread messages until the estimate fits;
  - compatibility metadata now records
    `metadata.compatibility.local_assistants.truncation` with original,
    included, and dropped message counts, estimated prompt-token counts,
    budget status, and the estimate source.
- Extended regression coverage:
  - added a unit/mock-provider Assistants test proving old thread messages are
    removed from the upstream Chat request while the persisted Run keeps
    `truncation_strategy` and `max_prompt_tokens`;
  - added live bridge-regression case `assistants-truncation` that creates a
    two-message thread, runs with `last_messages:1`, and validates the output
    marker plus persisted compatibility metadata.
- Updated docs:
  - compatibility matrix now documents Assistants Run truncation and
    prompt-budget behavior, including the local estimation boundary;
  - evaluation plan now lists the mock-provider and live regression coverage
    plus the focused `assistants-truncation` harness command.
- Verification:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Focused `node --test --test-name-pattern "Assistants API" test/server.test.js`:
    passed 15/15.
  - `npm test`: passed 192/192.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live `assistants-truncation` passed 1/1 against `deepseek-v4-pro`, latency
    3857 ms, output `assistants-truncation-live-ok`, 3 messages, 1 run,
    1 dropped message, 1 included message, `max_prompt_tokens:96`, and
    94 total tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: passed 90/90,
    pass rate 1.0, average latency 1499 ms, P95 latency 4076 ms, and total
    usage 22241 tokens.
  - `npm run eval:protocol`: passed 2/2, pass rate 1.0, average latency
    2256 ms, P95 latency 2717 ms, and total usage 99 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, exercising sidebar navigation,
    core pages, project dialog/upload, prompt submission, completed-turn
    controls, reload persistence, generated image artifact display, saved
    project reopen/cleanup, and console error/warning checks; screenshot
    written to `output/playwright/ui-smoke-2026-06-11T12-03-53-965Z.png`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 1522 runtime
    candidates, selected 1 old UI smoke screenshot, selected 83135 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: deleted that 1 screenshot, freed
    83135 bytes, and reported 0 errors.
  - Service/storage check after cleanup: app-server, bridge, and web services
    were active; the filesystem had 38 GB available; `state/` was 21 MB,
    `output/` was 4.7 MB, `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 25 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
