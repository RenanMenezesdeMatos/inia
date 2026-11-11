// Testes do acesso restrito às cópias do `npm run db:backup` (node --test "scripts/install/*.test.mjs") — item N03 da 4ª auditoria: a pasta
// e o arquivo da cópia nunca ficam legíveis por outros usuários da máquina, nem enquanto o pg_dump escreve.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, win32 } from "node:path"
import { after, describe, test } from "node:test"
import { createPrivateFile, findPgTool, restrictBackupDir, windowsRestrictArgs, windowsSystemTool } from "./backup-tools.mjs"

const base = mkdtempSync(join(tmpdir(), "inia-backup-teste-"))
after(() => rmSync(base, { recursive: true, force: true }))
const mode = (path) => statSync(path).mode & 0o777

describe("pasta das cópias — Linux/macOS", { skip: process.platform === "win32" }, () => {
  test("pasta nova (com as intermediárias) nasce só para o dono", () => {
    const dir = join(base, "nova", "backups")
    restrictBackupDir(dir)
    assert.equal(mode(dir), 0o700)
  })

  test("pasta que já existia aberta: fecha a pasta, as cópias e o registro da INIA; o resto da pasta não é tocado", () => {
    const dir = join(base, "existente")
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)
    const files = { dump: "inia-2026-10-20_145818.dump", partial: "inia-2026-10-21_020000.dump.partial", log: "backup.log", other: "leia-me.txt" }
    for (const name of Object.values(files)) {
      writeFileSync(join(dir, name), "x")
      chmodSync(join(dir, name), 0o644)
    }
    restrictBackupDir(dir)
    assert.equal(mode(dir), 0o700)
    for (const name of [files.dump, files.partial, files.log]) assert.equal(mode(join(dir, name)), 0o600, name)
    assert.equal(mode(join(dir, files.other)), 0o644)
  })

  test("o arquivo da cópia nasce fechado para o dono, antes de o pg_dump escrever; nunca reaproveita um que já existe", () => {
    const file = join(base, "inia-2026-10-29_120000.dump.partial")
    const previous = process.umask(0o022)
    try {
      createPrivateFile(file)
    } finally {
      process.umask(previous)
    }
    assert.equal(mode(file), 0o600)
    assert.throws(() => createPrivateFile(file), { code: "EEXIST" })
  })
})

describe("pasta das cópias — Windows (icacls simulado)", () => {
  const fake = (results) => {
    const calls = []
    const run = (command, args) => {
      calls.push([command, ...args])
      return results[command.replace(/^.*\\/, "").replace(/\.exe$/, "")] ?? { status: 0, stdout: "", stderr: "" }
    }
    return { calls, run }
  }
  const whoami = { status: 0, stdout: '"inia-srv\\\\admin","S-1-5-21-111-222-333-1001"\r\n', stderr: "" }

  const whoamiExe = windowsSystemTool("whoami")
  const icaclsExe = windowsSystemTool("icacls")

  test("sem herança, só Administradores, SYSTEM e quem roda a cópia — a pasta herda para dentro, os arquivos não; pasta que já existia passa a ser dos Administradores e perde as permissões explícitas antigas", () => {
    const dir = join(base, "win")
    mkdirSync(dir)
    writeFileSync(join(dir, "inia-2026-10-20_145818.dump"), "x")
    writeFileSync(join(dir, "outro.txt"), "x")
    const { calls, run } = fake({ whoami })
    restrictBackupDir(dir, { platform: "win32", run })
    assert.deepEqual(calls, [
      [whoamiExe, "/user", "/fo", "csv", "/nh"],
      [icaclsExe, dir, "/setowner", "*S-1-5-32-544"],
      [icaclsExe, dir, "/reset"],
      [icaclsExe, dir, "/inheritance:r", "/grant:r", "*S-1-5-32-544:(OI)(CI)(F)", "*S-1-5-18:(OI)(CI)(F)", "*S-1-5-21-111-222-333-1001:(OI)(CI)(F)"],
      [icaclsExe, join(dir, "inia-2026-10-20_145818.dump"), "/inheritance:r", "/grant:r", "*S-1-5-32-544:(F)", "*S-1-5-18:(F)", "*S-1-5-21-111-222-333-1001:(F)"],
    ])
  })

  test("pasta criada agora: o dono já é quem roda a cópia — sem /setowner nem /reset (backup manual sem prompt elevado continua funcionando)", () => {
    const dir = join(base, "win-nova")
    const { calls, run } = fake({ whoami })
    restrictBackupDir(dir, { platform: "win32", run })
    assert.deepEqual(calls, [
      [whoamiExe, "/user", "/fo", "csv", "/nh"],
      [icaclsExe, dir, "/inheritance:r", "/grant:r", "*S-1-5-32-544:(OI)(CI)(F)", "*S-1-5-18:(OI)(CI)(F)", "*S-1-5-21-111-222-333-1001:(OI)(CI)(F)"],
    ])
  })

  test("a tarefa agendada roda como SYSTEM: o SID não se repete", () => {
    assert.deepEqual(windowsRestrictArgs("D:\\backup", { directory: true, userSid: "S-1-5-18" }), ["D:\\backup", "/inheritance:r", "/grant:r", "*S-1-5-32-544:(OI)(CI)(F)", "*S-1-5-18:(OI)(CI)(F)"])
  })

  test("icacls ou whoami falhou: erro (a cópia não é feita numa pasta aberta)", () => {
    const dir = join(base, "win-falha")
    assert.throws(() => restrictBackupDir(dir, { platform: "win32", run: fake({ whoami, icacls: { status: 5, stdout: "", stderr: "Acesso negado." } }).run }), /icacls não restringiu .*Acesso negado/)
    assert.throws(() => restrictBackupDir(dir, { platform: "win32", run: fake({ whoami: { status: 1, stdout: "", stderr: "" } }).run }), /whoami/)
  })

  test("whoami e icacls sempre pelo caminho absoluto em System32 (a tarefa roda como SYSTEM na pasta da INIA)", () => {
    assert.equal(windowsSystemTool("icacls", { systemRoot: "D:\\WINDOWS" }), "D:\\WINDOWS\\System32\\icacls.exe")
    for (const systemRoot of [undefined, "", "Windows", "..\\x"]) assert.equal(windowsSystemTool("whoami", { systemRoot }), "C:\\Windows\\System32\\whoami.exe")
  })

  test("pg_dump/pg_restore no Windows: nunca o nome solto; --pg-bin só absoluto", () => {
    const { calls, run } = fake({ pg_dump: { status: 0, stdout: "pg_dump (PostgreSQL) 17.2", stderr: "" } })
    assert.deepEqual(findPgTool("pg_dump", { binDir: "D:\\pg\\bin", minMajor: 17, platform: "win32", run }), { path: "D:\\pg\\bin\\pg_dump.exe", major: 17 })
    const none = fake({ pg_dump: { status: 1, stdout: "", stderr: "" } })
    assert.equal(findPgTool("pg_dump", { platform: "win32", run: none.run }), null)
    assert.ok(none.calls.every(([command]) => win32.isAbsolute(command)), JSON.stringify(none.calls))
    assert.ok(calls.every(([command]) => win32.isAbsolute(command)))
    assert.throws(() => findPgTool("pg_dump", { binDir: "pg\\bin", platform: "win32", run }), /absoluto/)
  })
})
