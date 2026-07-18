/* global document, parent, ResizeObserver, addEventListener */
(() => {
  'use strict'
  const token = document.body.dataset.neoankiToken || ''
  const send = () => parent.postMessage({ neoAnkiCardHeight: document.documentElement.scrollHeight, token }, '*')
  new ResizeObserver(send).observe(document.body)
  addEventListener('load', send, { once: true })
  send()
})()
