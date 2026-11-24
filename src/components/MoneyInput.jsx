import {useId,useLayoutEffect,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {formatMoney,moneyEditValue,moneyInputError,parseMoneyInput} from '../money.js'
import './money-input.css'

// Text, not type=number: identical comma/miles behavior in Chrome and Safari.
// Keep the exact draft while editing (including invalid or unfinished input).
export default function MoneyInput({value='',onChange,onFocus,onBlur,min,max,step:ignoredStep,type:ignoredType,inputMode:ignoredMode,...props}){
 const ref=useRef(null),id=useId(),[focused,setFocused]=useState(false),[touched,setTouched]=useState(false),[draft,setDraft]=useState(()=>moneyEditValue(value))
 const issue=moneyInputError(value,{min,max}),parsed=parseMoneyInput(value)
 const display=focused?draft:value===''||value==null?'':Number.isFinite(parsed)?formatMoney(parsed):String(value)
 useLayoutEffect(()=>{ref.current?.setCustomValidity(issue)},[issue,value])
 useLayoutEffect(()=>{if(focused)setDraft(typeof value==='number'?moneyEditValue(value):String(value??''))},[value])
 return <><input {...props} ref={ref} type="text" inputMode="decimal" lang="es-AR" value={display}
  aria-invalid={issue&&touched?'true':props['aria-invalid']} aria-describedby={issue&&touched?id:props['aria-describedby']}
  onFocus={e=>{
   // Finish changing the displayed value before the browser selects/pastes text.
   // Otherwise replacing a prefilled amount can append to its previous contents.
   flushSync(()=>{setDraft(moneyEditValue(value));setFocused(true)})
   onFocus?.(e)
  }} onChange={e=>{setDraft(e.target.value);onChange?.(e)}}
  onBlur={e=>{setFocused(false);setTouched(true);onBlur?.(e)}}/>
  {issue&&touched&&<small className="win-money-error" id={id} role="alert">{issue} El contenido se conserva para corregirlo.</small>}
 </>
}
