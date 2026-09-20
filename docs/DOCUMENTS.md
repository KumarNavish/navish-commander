# Document workflows

Chat supplies the reasoning and content. Commander parses and writes files locally;
these tools do not call a model service.

| Format | Read | Write and edit |
| --- | --- | --- |
| DOCX | Text-bearing outline; nonzero line offsets expose XML | Create from Markdown; exact XML replacement, including headers and footers |
| XLSX | Sheet selection, A1 ranges, row pagination, typed cells and formulas | JSON rows or named sheets; append; range edits |
| PDF | Page pagination, text continuation and optional embedded images | Markdown/HTML creation; ordered page insert/delete; copy pages from another PDF |
| PNG, JPEG, GIF, WebP | Native MCP image content; large images become JPEG thumbnails | Base64 image write |
| HTTP(S) URL | Explicit `isUrl: true`; same format readers after download | Read only |

Document writes are prepared in a private temporary directory, validated, then
atomically published. Existing permissions are retained. `expectedSha256` rejects
a changed destination; source changes during preparation also reject publication.
Keep the same `callId` after a lost reply. PDF modification requires a distinct
`outputPath`, preserving the input file.

PDF offsets count pages from zero. For partial page text, continue with the
returned `nextOffset` and `options.textOffset = nextTextOffset`. `hasMore`,
`truncated`, and `imagesTruncated` describe incomplete output. Text output is bounded
by `maxBytes`; native image content has a shared 700 KB base64 budget per response.
URL downloads allow five redirects, a 15-second deadline and at most 16 MiB.

PDF creation and image thumbnails use an installed Chrome/Chromium executable.
Set `NAVISH_CHROMIUM` when it is outside a standard location. Each render uses a
private temporary profile, disabled page JavaScript and a pipe connection. PDF
HTML may reference authorized local images; remote assets are not fetched. No
browser download, signed-in profile or paid service is needed.

Legacy binary XLS writes and macro-preserving XLSM edits are unsupported. XLSM
reads are available. Excel formulas are stored, not recalculated. Complex Excel
features unsupported by ExcelJS may not survive a rewrite; keep the source copy
when editing a workbook with charts, macros or external data connections.

DOCX and Excel engines adapt the MIT-licensed Desktop Commander 0.2.51 handlers.
The original license is included in `runtime/app/src/DESKTOP_COMMANDER_LICENSE.txt`;
[provenance](DOCUMENT_ENGINE_PROVENANCE.json) records upstream hashes and local
changes. Reusing those components is separate from the hosted RDC benchmark.

For rendering on Linux, select the installed browser explicitly when the distribution provides Chromium launcher stubs: `NAVISH_CHROMIUM=/usr/bin/google-chrome`. CI uses this setting with the system-installed Google Chrome; no browser sandbox is disabled by document tools.
