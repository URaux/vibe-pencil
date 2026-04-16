import React from 'react'
import { useEffect } from 'react'

export const Title = ({ text }) => <h1>{text}</h1>

export function Layout({ children }) {
  useEffect(() => {}, [])
  return <div className="layout">{children}</div>
}

export default Layout
