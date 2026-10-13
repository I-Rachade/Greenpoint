Xingke Unified API Protocol for Two-Wheeler Charging Devices
Version 1.0 | English JSON Package | 13 October 2026

This package accompanies Xingke_Two-Wheeler_Charging_Device_API_V1.0_EN.pdf.

CONTENTS
1. openapi.json: OpenAPI 3.1 description of command submission, command-result queries and event callbacks.
2. unified-api.schema.json: JSON Schema 2020-12 with command, event, query, response and acknowledgement definitions.
3. examples/: 34 complete JSON examples covering all seven command actions and seven event actions, plus HTTP responses, an empty query request and callback acknowledgement.

SERVER AND TRANSPORT
Platform Base URL: https://{apiHost}
The production Host is not yet assigned. Replace apiHost with the domain/IP and optional port provided by the platform. The api.example.invalid default in OpenAPI is a non-production placeholder.

All three interfaces use POST. All request and response bodies use application/json and UTF-8.
- Submit command: /openapi/v1/devices/{deviceId}/commands
- Query command: /openapi/v1/devices/{deviceId}/commands/{messageId}/query
  The query body must be {}. A query never redispatches the command.
- Event callback: the partner's preconfigured fixed HTTPS callback URL, illustrated as https://{callbackHost}/{callbackPath} in the PDF.
  callback.example.invalid is also a placeholder. Configure the real callback URL separately from the platform Host.

The platform provides the command and query endpoints. The partner provides one callback endpoint for both command results and unsolicited device events.
Requests use Accept: application/json and Authorization: Bearer <credential>. Callbacks use a separate credential from platform access. The HTTP client supplies Host from the target URL; Host is not a JSON field.

IDENTIFIERS AND CORRELATION
deviceId identifies the device terminal. It is placed in command/query URLs and at the top level of event callbacks.
connectorId identifies a logical charging output within that terminal. The current profile supports channels 1-16. Channel operations on multichannel devices require it; device-wide operations forbid it. Single-channel commands may omit it and normalize to 1.
transactionId is a partner-generated 20-digit charging correlation string. idTag is a 10-digit decimal card-number string. Preserve leading zeros.
Ordinary commands use a partner-generated messageId. CommandResult and HTTP responses echo it. Unsolicited events use a platform-generated messageId.
AuthorizeResponse must reuse the messageId of the CardPresented being answered and match the device, channel and card number. Retries preserve the original identifier and content.

RESULTS AND CALLBACKS
HTTP 202 means accepted, not that the device executed the command.
Use CommandResult or a query to obtain Succeeded, Failed, Unknown or Sent. Unknown does not prove failure. Sent is reserved for AuthorizeResponse, for which the device has no execution acknowledgement.
Deduplicate unsolicited events by deviceId + action + messageId. For CommandResult, include data.status so that a confirmed result after Unknown is not discarded.
Return HTTP 200 with {"code":"OK"} after durable storage or idempotent processing, including for duplicate callbacks. Acknowledge within 3 seconds. See the PDF for retry timing and out-of-order handling.

SCHEMA VALIDATION
The root of unified-api.schema.json validates command and event envelopes.
For other structures, resolve these definitions within that same schema document:
- #/$defs/CommandQueryRequest: empty POST query body
- #/$defs/ApiResponse: successful acceptance, query or idempotent response
- #/$defs/ErrorResponse: HTTP error response
- #/$defs/CallbackAck: callback acknowledgement
Use a JSON Schema 2020-12 validator with date, date-time and URI format checking enabled.
The generic schema permits connectorId omission for future single-channel devices. The server must enforce required channels for multichannel devices using actual device metadata.
Permissions, actual channel count, enabled firmware capabilities, card-event expiry, channel uniqueness and idempotency require runtime checks in addition to schema validation.

DATA CONVENTIONS
Field names and enum values are case-sensitive. Use native JSON types, not serialized JSON strings. Omit missing optional fields instead of filling them with null, empty strings or zero.
Durations are seconds. Monetary values are CNY cents (fen). Measurements use the field-specific units in the PDF. Timestamps use UTC RFC3339 with a trailing Z. Card expiry dates use YYYY-MM-DD and are interpreted in Asia/Shanghai.

EXAMPLES
Device IDs, card numbers, timestamps and firmware URLs are illustrative. Do not use the sample URL as a real firmware package.
English message values are human-readable example text, not identifiers for program logic. Use code, status, action and requestAction as defined by the protocol.
Field names, enum values, constraints and example business values match the final English PDF. The current 16-channel profile constraints remain unchanged; the device category is Two-Wheeler Charging Devices.
