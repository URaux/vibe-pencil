import * as React from 'react'
import { useState } from 'react'

export interface ButtonProps {
  label: string
}

export const Button: React.FC<ButtonProps> = ({ label }) => {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{label}: {count}</button>
}

export function Panel() {
  return <div><Button label="click" /></div>
}

export default Panel
