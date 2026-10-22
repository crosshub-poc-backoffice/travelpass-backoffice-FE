'use client'

import { useSyncExternalStore } from 'react'
import { PRODUCTS as INITIAL_PRODUCTS, type Product } from './mock-data'

// 상품 목록을 앱 전역에서 공유하는 저장소(모듈 싱글턴).
// layout.tsx에 Provider를 추가로 얹지 않고도, 등록/수정 위저드에서 바뀐 값이
// 상품 목록 페이지에 즉시 반영되도록 useSyncExternalStore로 구독한다.
let products: Product[] = [...INITIAL_PRODUCTS]
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return products
}

export function useProducts(): Product[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id)
}

export function addProduct(product: Product) {
  products = [product, ...products]
  notify()
}

export function updateProduct(id: string, patch: Partial<Product>) {
  products = products.map((p) => (p.id === id ? { ...p, ...patch } : p))
  notify()
}

export function removeProduct(id: string) {
  products = products.filter((p) => p.id !== id)
  notify()
}
