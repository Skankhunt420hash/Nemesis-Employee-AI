# OpenHands Agent Server 1.64.0: Endpunkte (aus der OpenAPI-Spezifikation des offiziellen Pakets)

Erzeugt am 24.11.2026 mit `openhands.agent_server.api.create_app().openapi()` (Paket `openhands-agent-server==1.64.0`, MIT).
Authentifizierung: Header `X-Session-API-Key` (Schlüssel aus `OH_SESSION_API_KEYS_0` bzw. `SESSION_API_KEY`). `/alive`, `/ready` und `/server_info` antworten ohne Schlüssel (getestet); `/api/conversations/count` ohne Schlüssel → 401 (getestet).

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/` | Get Server Info |
| GET | `/alive` | Alive |
| POST | `/api/acp/models` | Discover Models |
| GET | `/api/agent-profiles` | List Agent Profiles |
| GET | `/api/agent-profiles/{name}` | Get Agent Profile |
| POST | `/api/agent-profiles/{name}` | Save Agent Profile |
| DELETE | `/api/agent-profiles/{name}` | Delete Agent Profile |
| POST | `/api/agent-profiles/{name}/materialize` | Materialize Agent Profile |
| POST | `/api/agent-profiles/{name}/rename` | Rename Agent Profile |
| POST | `/api/agent-profiles/{profile_id}/activate` | Activate Agent Profile |
| POST | `/api/auth/workspace-session` | Create Workspace Session |
| DELETE | `/api/auth/workspace-session` | Delete Workspace Session |
| POST | `/api/bash/bash_commands/{command_id}/stop` | Stop Bash Command |
| DELETE | `/api/bash/bash_events` | Clear All Bash Events |
| GET | `/api/bash/bash_events/` | Batch Get Bash Events |
| GET | `/api/bash/bash_events/search` | Search Bash Events |
| GET | `/api/bash/bash_events/{event_id}` | Get Bash Event |
| POST | `/api/bash/execute_bash_command` | Execute Bash Command |
| POST | `/api/bash/start_bash_command` | Start Bash Command |
| GET | `/api/conversations` | Batch Get Conversations |
| POST | `/api/conversations` | Start Conversation |
| GET | `/api/conversations/count` | Count Conversations |
| GET | `/api/conversations/search` | Search Conversations |
| GET | `/api/conversations/{conversation_id}` | Get Conversation |
| DELETE | `/api/conversations/{conversation_id}` | Delete Conversation |
| PATCH | `/api/conversations/{conversation_id}` | Update Conversation |
| GET | `/api/conversations/{conversation_id}/agent_final_response` | Get Conversation Agent Final Response |
| POST | `/api/conversations/{conversation_id}/ask_agent` | Ask Agent |
| POST | `/api/conversations/{conversation_id}/ask_user/answer` | Answer Ask User |
| POST | `/api/conversations/{conversation_id}/children` | Start Child Conversation |
| POST | `/api/conversations/{conversation_id}/condense` | Condense Conversation |
| POST | `/api/conversations/{conversation_id}/confirmation_policy` | Set Conversation Confirmation Policy |
| GET | `/api/conversations/{conversation_id}/events` | Batch Get Conversation Events |
| POST | `/api/conversations/{conversation_id}/events` | Send Message |
| POST | `/api/conversations/{conversation_id}/events/batch` | Batch Get Conversation Events Via Post |
| GET | `/api/conversations/{conversation_id}/events/count` | Count Conversation Events |
| POST | `/api/conversations/{conversation_id}/events/respond_to_confirmation` | Respond To Confirmation |
| GET | `/api/conversations/{conversation_id}/events/search` | Search Conversation Events |
| GET | `/api/conversations/{conversation_id}/events/{event_id}` | Get Conversation Event |
| POST | `/api/conversations/{conversation_id}/fork` | Fork Conversation |
| POST | `/api/conversations/{conversation_id}/goal` | Start Goal In Conversation |
| POST | `/api/conversations/{conversation_id}/goal/resume` | Resume Goal In Conversation |
| POST | `/api/conversations/{conversation_id}/goal/stop` | Stop Goal In Conversation |
| POST | `/api/conversations/{conversation_id}/interrupt` | Interrupt Conversation |
| POST | `/api/conversations/{conversation_id}/load_plugin` | Load Conversation Plugin |
| POST | `/api/conversations/{conversation_id}/mcp` | Add Conversation Mcp Servers |
| GET | `/api/conversations/{conversation_id}/model_router` | Get Conversation Model Router |
| PATCH | `/api/conversations/{conversation_id}/model_router` | Update Conversation Model Router |
| POST | `/api/conversations/{conversation_id}/model_router/routes` | Add Conversation Model Router Route |
| POST | `/api/conversations/{conversation_id}/navigate` | Navigate Conversation |
| POST | `/api/conversations/{conversation_id}/pause` | Pause Conversation |
| POST | `/api/conversations/{conversation_id}/reactions` | React To Message |
| POST | `/api/conversations/{conversation_id}/run` | Run Conversation |
| GET | `/api/conversations/{conversation_id}/runtime` | Get Local Conversation Runtime |
| POST | `/api/conversations/{conversation_id}/runtime/reprovision` | Reprovision Local Conversation Runtime |
| POST | `/api/conversations/{conversation_id}/secrets` | Update Conversation Secrets |
| POST | `/api/conversations/{conversation_id}/security_analyzer` | Set Conversation Security Analyzer |
| POST | `/api/conversations/{conversation_id}/switch_acp_effort` | Switch Conversation Acp Effort |
| POST | `/api/conversations/{conversation_id}/switch_acp_model` | Switch Conversation Acp Model |
| POST | `/api/conversations/{conversation_id}/switch_llm` | Switch Conversation Llm |
| POST | `/api/conversations/{conversation_id}/switch_profile` | Switch Conversation Profile |
| GET | `/api/conversations/{conversation_id}/workspace` | Serve Workspace Root |
| GET | `/api/conversations/{conversation_id}/workspace/{file_path}` | Serve Workspace File |
| POST | `/api/conversations/{runtime_conversation_id}/bash/bash_commands/{command_id}/stop` | Stop Bash Command |
| DELETE | `/api/conversations/{runtime_conversation_id}/bash/bash_events` | Clear All Bash Events |
| GET | `/api/conversations/{runtime_conversation_id}/bash/bash_events/` | Batch Get Bash Events |
| GET | `/api/conversations/{runtime_conversation_id}/bash/bash_events/search` | Search Bash Events |
| GET | `/api/conversations/{runtime_conversation_id}/bash/bash_events/{event_id}` | Get Bash Event |
| POST | `/api/conversations/{runtime_conversation_id}/bash/execute_bash_command` | Execute Bash Command |
| POST | `/api/conversations/{runtime_conversation_id}/bash/start_bash_command` | Start Bash Command |
| GET | `/api/conversations/{runtime_conversation_id}/file/archive` | Archive Directory |
| POST | `/api/conversations/{runtime_conversation_id}/file/create_directory` | Create Directory |
| GET | `/api/conversations/{runtime_conversation_id}/file/download` | Download File Query |
| GET | `/api/conversations/{runtime_conversation_id}/file/download-trajectory/{conversation_id}` | Download Trajectory |
| POST | `/api/conversations/{runtime_conversation_id}/file/upload` | Upload File Query |
| GET | `/api/conversations/{runtime_conversation_id}/git/changes` | Git Changes Query |
| GET | `/api/conversations/{runtime_conversation_id}/git/commits` | Git Commits Query |
| GET | `/api/conversations/{runtime_conversation_id}/git/commits/{sha}/changes` | Git Commit Changes Query |
| GET | `/api/conversations/{runtime_conversation_id}/git/diff` | Git Diff Query |
| GET | `/api/conversations/{runtime_conversation_id}/vscode/status` | Get Vscode Status |
| GET | `/api/conversations/{runtime_conversation_id}/vscode/url` | Get Runtime Vscode Url |
| GET | `/api/file/archive` | Archive Directory |
| POST | `/api/file/create_directory` | Create Directory |
| GET | `/api/file/download` | Download File Query |
| GET | `/api/file/download-trajectory/{conversation_id}` | Download Trajectory |
| GET | `/api/file/home` | Get Home Directory |
| GET | `/api/file/search_subdirs` | Search Subdirs |
| POST | `/api/file/upload` | Upload File Query |
| GET | `/api/git/changes` | Git Changes Query |
| GET | `/api/git/commits` | Git Commits Query |
| GET | `/api/git/commits/{sha}/changes` | Git Commit Changes Query |
| GET | `/api/git/diff` | Git Diff Query |
| GET | `/api/git/repositories/search` | Git Repositories Search |
| GET | `/api/git/repositories/{owner}/{repo}/pull-requests/{number}` | Git Pull Request Status |
| POST | `/api/hooks` | Get Hooks |
| GET | `/api/init` | Get Init Status |
| POST | `/api/init` | Initialize Server |
| GET | `/api/llm/models` | List Models |
| GET | `/api/llm/models/verified` | List Verified Models |
| GET | `/api/llm/provider-connections` | List Provider Connections |
| POST | `/api/llm/provider-connections` | Create Provider Connection |
| PATCH | `/api/llm/provider-connections/{connection_id}` | Update Provider Connection |
| DELETE | `/api/llm/provider-connections/{connection_id}` | Delete Provider Connection |
| GET | `/api/llm/providers` | List Providers |
| POST | `/api/llm/subscription/openai/device/poll` | Poll Openai Subscription Device Login |
| POST | `/api/llm/subscription/openai/device/start` | Start Openai Subscription Device Login |
| POST | `/api/llm/subscription/openai/logout` | Logout Openai Subscription |
| GET | `/api/llm/subscription/openai/models` | List Openai Subscription Models |
| GET | `/api/llm/subscription/openai/status` | Get Openai Subscription Status |
| POST | `/api/mcp/oauth/callback/{job_id}` | Submit an MCP OAuth callback URL |
| POST | `/api/mcp/oauth/start` | Start an MCP OAuth install probe |
| GET | `/api/mcp/oauth/status/{job_id}` | Get an MCP OAuth install probe status |
| POST | `/api/mcp/test` | Test an MCP server configuration |
| GET | `/api/meta-profiles` | List Meta Profiles |
| GET | `/api/meta-profiles/{name}` | Get Meta Profile |
| POST | `/api/meta-profiles/{name}` | Save Meta Profile |
| DELETE | `/api/meta-profiles/{name}` | Delete Meta Profile |
| POST | `/api/meta-profiles/{name}/activate` | Activate Meta Profile |
| POST | `/api/plugins` | Get Plugins |
| POST | `/api/plugins/fetch` | Fetch Plugin Endpoint |
| POST | `/api/plugins/install` | Install Plugin Endpoint |
| GET | `/api/plugins/installed` | List Installed Plugins Endpoint |
| GET | `/api/plugins/installed/{plugin_name}` | Get Installed Plugin Endpoint |
| PATCH | `/api/plugins/installed/{plugin_name}` | Set Plugin Enabled Endpoint |
| DELETE | `/api/plugins/installed/{plugin_name}` | Uninstall Plugin Endpoint |
| POST | `/api/plugins/installed/{plugin_name}/refresh` | Refresh Plugin Endpoint |
| GET | `/api/plugins/marketplace` | Get Marketplace Catalog |
| GET | `/api/profiles` | List Profiles |
| GET | `/api/profiles/{name}` | Get Profile |
| POST | `/api/profiles/{name}` | Save Profile |
| DELETE | `/api/profiles/{name}` | Delete Profile |
| POST | `/api/profiles/{name}/activate` | Activate Profile |
| POST | `/api/profiles/{name}/rename` | Rename Profile |
| POST | `/api/profiles/{name}/validate` | Validate Profile |
| GET | `/api/settings` | Get Settings |
| PATCH | `/api/settings` | Update Settings |
| GET | `/api/settings/agent-schema` | Get Agent Settings Schema |
| GET | `/api/settings/conversation-schema` | Get Conversation Settings Schema |
| GET | `/api/settings/experimental` | List Experimental Features |
| PATCH | `/api/settings/experimental/{key}` | Update Experimental Feature |
| POST | `/api/settings/mcp/{settings_key}` | Create Mcp Server |
| PATCH | `/api/settings/mcp/{settings_key}` | Patch Mcp Server |
| DELETE | `/api/settings/mcp/{settings_key}` | Delete Mcp Server |
| GET | `/api/settings/secrets` | List Secrets |
| PUT | `/api/settings/secrets` | Create Secret |
| GET | `/api/settings/secrets/{name}` | Get Secret Value |
| DELETE | `/api/settings/secrets/{name}` | Delete Secret |
| POST | `/api/skills` | Get Skills |
| GET | `/api/skills/catalog` | Get Skill Catalog |
| POST | `/api/skills/install` | Install Skill Endpoint |
| GET | `/api/skills/installed` | List Installed Skills Endpoint |
| GET | `/api/skills/installed/{skill_name}` | Get Installed Skill Endpoint |
| PATCH | `/api/skills/installed/{skill_name}` | Set Skill Enabled Endpoint |
| DELETE | `/api/skills/installed/{skill_name}` | Uninstall Skill Endpoint |
| POST | `/api/skills/installed/{skill_name}/refresh` | Refresh Skill Endpoint |
| GET | `/api/skills/marketplace` | Get Marketplace Catalog |
| POST | `/api/skills/sync` | Sync Skills |
| POST | `/api/sub-agents` | Get Sub Agents |
| GET | `/api/tools/` | List Available Tools |
| GET | `/api/tools/catalog` | Get Tool Catalog |
| GET | `/api/vscode/status` | Get Vscode Status |
| GET | `/api/vscode/url` | Get Vscode Url |
| GET | `/api/workspaces` | List Workspaces |
| POST | `/api/workspaces` | Add Workspaces |
| DELETE | `/api/workspaces` | Delete Workspace |
| POST | `/api/workspaces/parents` | Add Workspace Parents |
| DELETE | `/api/workspaces/parents` | Delete Workspace Parent |
| POST | `/app-backends/{extension_name}/session` | Create App Backend Session Endpoint |
| DELETE | `/app-backends/{extension_name}/session` | Delete App Backend Session Endpoint |
| GET | `/health` | Health |
| GET | `/ready` | Ready |
| GET | `/server_info` | Get Server Info |
| POST | `/v1/chat/completions` | Create Chat Completion |
| GET | `/v1/models` | Get Openai Models |
| POST | `/v1/responses` | Create Response |
