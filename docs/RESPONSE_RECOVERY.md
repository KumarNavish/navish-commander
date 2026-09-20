# Recovering an identified connector response

Connector 0.1.3 adds `connectorOperation` to newly journaled responses before upload. Successful reads previously lost their relay operation ID at the MCP boundary, although the durable queue retained it. Responses now identify the original tool and request hash, plus applicable device, path, call, session and batch IDs. Command bodies, environment variables and file-write content are not copied into this metadata.

For example, a file result includes:

```json
{
  "state": "completed",
  "result": {"path": "/workspace/input.json", "content": "..."},
  "connectorOperation": {
    "operationId": "<64-character operation ID>",
    "toolName": "commander_read_file",
    "requestSha256": "<canonical request SHA-256>",
    "device": "local",
    "path": "/workspace/input.json"
  }
}
```

Check that the tool and target match the intended call. If a response is missing or attached to the wrong call, use `commander_connector_receipt` with the original known operation ID. For a mutation whose response was lost, its original `callId` is also sufficient. An ID from an unrelated output cannot identify the missing operation. If no original identity is available, report the result as unverified.

The connector returns the already recorded result without invoking the Mac tool again. The identity persists across upload acknowledgement loss and reconnect. Existing journal records remain unchanged, so responses recorded before 0.1.3 may lack `connectorOperation`. Queued, failed and uncertain states keep their existing meaning; identity metadata does not establish successful work.

After a denied action, stop that intent and reconcile any operations already dispatched using read-only observations. One denial does not establish that every earlier or concurrent action had no effect. The continuation evaluation exposed this distinction: a chat reported no changes, while its original completed receipt proved a 499-byte source-file write. Reconciliation must preserve and report that partial effect rather than replay it or erase it from the summary.

This improves response attribution and recovery. It does not repair ChatGPT's export implementation or bypass its permission checks. The observed export omissions and misattribution remain in the original evaluation. A missing export is not, by itself, evidence that the provider denied a call.

Three regressions fail before this change and pass afterward: retrieving a completed read through its durable ID, distinguishing concurrent equal-content reads, and retaining failed outcomes without echoing sensitive command fields. The full runtime/MCP suite passes 120 tests. The code also preserves the existing lost-upload/no-reexecution regression and the real relay-to-MCP four-worker fixture.
