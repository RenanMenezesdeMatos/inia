/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { profileImageSrc } from "@/lib/profile/profile-image-src"

import { PersonAvatar } from "./person-avatar"

/** O jsdom não carrega imagens; o Avatar do Radix só troca as iniciais pela foto depois do `load`.
 * Este stub dispara `load` para qualquer URL e `error` para as que contêm "broken". */
class FakeImage extends EventTarget {
  private source = ""
  complete = false
  naturalWidth = 0
  set src(value: string) {
    this.source = value
    setTimeout(() => {
      const broken = value.includes("broken")
      this.complete = true
      this.naturalWidth = broken ? 0 : 128
      this.dispatchEvent(new Event(broken ? "error" : "load"))
    }, 0)
  }
  get src() {
    return this.source
  }
}

beforeAll(() => {
  window.Image = FakeImage as unknown as typeof Image
})
afterEach(cleanup)

describe("PersonAvatar", () => {
  it("foto do perfil (servida pela API) é pedida à origem da API, nunca ao Next", async () => {
    render(<PersonAvatar name="Ana Operadora" avatarUrl="/api/v1/profile-images/foto-ana" />)
    const image = await screen.findByRole("img", { name: "Ana Operadora" })
    expect(image).toHaveAttribute("src", profileImageSrc("/api/v1/profile-images/foto-ana"))
    expect(image.getAttribute("src")).toMatch(/^https?:\/\/.+\/api\/v1\/profile-images\/foto-ana$/)
  })

  it("imagem corporativa do cadastro continua como veio; o texto alternativo pode ser vazio quando o nome está ao lado", async () => {
    const { container } = render(<PersonAvatar name="Bia Operadora" avatarUrl="https://cdn.cliente/bia.jpg" alt="" />)
    await waitFor(() => expect(container.querySelector('img[data-slot="avatar-image"]')).toHaveAttribute("src", "https://cdn.cliente/bia.jpg"))
    expect(container.querySelector("img")).toHaveAttribute("alt", "")
  })

  it("sem foto, ou se ela falhar, mostra as iniciais do nome", async () => {
    render(<PersonAvatar name="caio operador" avatarUrl={null} />)
    expect(screen.getByText("CO")).toBeInTheDocument()
    cleanup()
    const { container } = render(<PersonAvatar name="Dora Sem Dados" avatarUrl="https://cdn.cliente/broken.jpg" />)
    await waitFor(() => expect(screen.getByText("DS")).toBeInTheDocument())
    expect(container.querySelector("img")).toBeNull()
  })
})
