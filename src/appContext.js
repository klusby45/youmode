import { createContext, useContext } from 'react'

export const AppCtx = createContext(null)
export function useApp() {
  return useContext(AppCtx)
}
