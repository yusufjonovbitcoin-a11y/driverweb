import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const allowed = new Set([
  "finance_credit_invoice",
  "finance_void_credit",
  "finance_save_defaults",
  "finance_workspace",
  "finance_create_document",
  "finance_document_action",
  "finance_record_payment",
  "finance_payment_action",
  "finance_save_rule",
  "finance_recurring_command",
]);
const literal = (value) =>
  value == null
    ? "null"
    : typeof value === "boolean"
      ? String(value)
      : "'" +
        String(
          typeof value === "object" ? JSON.stringify(value) : value,
        ).replaceAll("'", "''") +
        "'";
export default defineConfig({
  envDir: false,
  plugins: [
    react(),
    {
      name: "isolated-finance-qa",
      configureServer(server) {
        server.middlewares.use("/__finance_qa_rpc", async (req, res) => {
          res.setHeader("Content-Type", "application/json");
          try {
            if (req.method !== "POST") throw new Error("POST required");
            if (
              req.headers.host !== "127.0.0.1:5187" ||
              (req.headers.origin &&
                req.headers.origin !== "http://127.0.0.1:5187") ||
              !req.headers["content-type"]?.startsWith("application/json")
            )
              throw new Error("Local same-origin JSON requests only");
            let body = "";
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 100000) throw new Error("Request too large");
            }
            const { name, args } = JSON.parse(body);
            if (!allowed.has(name) || !Array.isArray(args))
              throw new Error("RPC not allowed");
            const sql =
              "set role authenticated;select set_config('test.user','20000000-0000-0000-0000-000000000001',false);select coalesce(to_jsonb(public." +
              name +
              "(" +
              args.map(literal).join(",") +
              ")),'null'::jsonb);";
            const { stdout } = await run(
              "psql",
              [
                "-h",
                "/tmp",
                "-p",
                "55439",
                "-d",
                "financecheck",
                "-tA",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                sql,
              ],
              { maxBuffer: 4 * 1024 * 1024 },
            );
            res.end(
              JSON.stringify({
                result: JSON.parse(stdout.trim().split("\n").at(-1) || "null"),
              }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: error.stderr || error.message }));
          }
        });
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: /^.*\/services\/finance\/api(?:\.js)?$/,
        replacement: fileURLToPath(new URL("./api.stub.js", import.meta.url)),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
});
