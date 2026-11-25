"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** Perto o bastante do fim para voltar a acompanhar. */
const END_SLACK_PX = 24
/** Longe o bastante para oferecer a volta (um empurrãozinho não mostra o botão). */
const AWAY_PX = 64

/** Quanto tempo depois de um gesto uma subida da lista ainda é da pessoa (rolagem suave, inércia). */
const INTENT_MS = 1_500
const UPWARD_KEYS = new Set(["ArrowUp", "PageUp", "Home", " "])

const distanceToEnd = (viewport: HTMLElement) => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight

/**
 * Acompanhar a conversa: no fim, a lista segue a resposta enquanto ela cresce (e enquanto o painel muda de tamanho); quem rolou para cima
 * fica onde está e ganha "Ir para a resposta mais recente". Subir, por pouco que seja, é um pedido de parar de acompanhar — nunca se disputa
 * a rolagem com a pessoa.
 */
export function useFollowLatest() {
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const followingRef = useRef(true)
  const topRef = useRef(0)
  const [away, setAway] = useState(false)

  const settle = useCallback((element: HTMLElement) => {
    if (element.clientHeight === 0) return
    element.scrollTop = followingRef.current ? element.scrollHeight : topRef.current
    topRef.current = element.scrollTop
    setAway(!followingRef.current && distanceToEnd(element) > AWAY_PX)
  }, [])

  useEffect(() => {
    if (!viewport) return
    let hidden = viewport.clientHeight === 0
    // Só um gesto da pessoa para de acompanhar. Subir sem gesto é o navegador ajustando a posição (o conteúdo encolheu — a saudação saiu, o
    // indicador virou resposta — e cresceu de novo antes de o evento chegar).
    let intentAt = -Infinity
    let pressing = false
    const markIntent = () => { intentAt = performance.now() }
    const onKey = (event: KeyboardEvent) => { if (UPWARD_KEYS.has(event.key)) markIntent() }
    const onPress = () => { pressing = true }
    const onRelease = () => {
      if (pressing) markIntent()
      pressing = false
    }
    // A barra de rolagem é irmã da área que rola: os gestos são ouvidos no bloco inteiro.
    const root = viewport.parentElement ?? viewport
    const onScroll = () => {
      if (viewport.clientHeight === 0) return
      const distance = distanceToEnd(viewport)
      const byPerson = pressing || performance.now() - intentAt < INTENT_MS
      if (viewport.scrollTop < topRef.current - 0.5) {
        if (byPerson) followingRef.current = distance <= 1
        else if (followingRef.current) return settle(viewport)
      }
      else if (distance <= END_SLACK_PX) followingRef.current = true
      topRef.current = viewport.scrollTop
      setAway(!followingRef.current && distance > AWAY_PX)
    }
    const onResize = () => {
      if (viewport.clientHeight === 0) {
        hidden = true
        return
      }
      // Parado no meio da conversa, crescer o conteúdo não mexe na posição; voltar a aparecer (painel reaberto) a restaura.
      if (followingRef.current || hidden) settle(viewport)
      else setAway(distanceToEnd(viewport) > AWAY_PX)
      hidden = false
    }
    viewport.addEventListener("scroll", onScroll, { passive: true })
    root.addEventListener("wheel", markIntent, { passive: true })
    root.addEventListener("touchmove", markIntent, { passive: true })
    root.addEventListener("keydown", onKey)
    // Tab até um botão de uma mensagem anterior também leva a lista até ele.
    root.addEventListener("focusin", markIntent)
    root.addEventListener("pointerdown", onPress)
    window.addEventListener("pointerup", onRelease)
    window.addEventListener("pointercancel", onRelease)
    const observer = new ResizeObserver(onResize)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => {
      viewport.removeEventListener("scroll", onScroll)
      root.removeEventListener("wheel", markIntent)
      root.removeEventListener("touchmove", markIntent)
      root.removeEventListener("keydown", onKey)
      root.removeEventListener("focusin", markIntent)
      root.removeEventListener("pointerdown", onPress)
      window.removeEventListener("pointerup", onRelease)
      window.removeEventListener("pointercancel", onRelease)
      observer.disconnect()
      // A lista saiu de cena (outra conversa, sala de apoio, sessão de feedback): a próxima começa no fim.
      followingRef.current = true
      topRef.current = 0
      setAway(false)
    }
  }, [viewport, settle])

  /** Vai para o fim e volta a acompanhar (envio de mensagem, conversa aberta, botão). */
  const followLatest = useCallback(() => {
    followingRef.current = true
    if (viewport) settle(viewport)
  }, [viewport, settle])

  return { viewport, setViewport, away, followLatest }
}
