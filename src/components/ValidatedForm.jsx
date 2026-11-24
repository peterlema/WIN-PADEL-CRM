import {useEffect,useId,useRef,useState} from 'react'
import {createPortal} from 'react-dom'

const validationMessage=el=>el.validity.valueMissing?'Completá este campo.':el.validity.rangeUnderflow?'El valor mínimo es '+el.min+'.':el.validity.rangeOverflow?'El valor máximo es '+el.max+'.':el.validity.stepMismatch?'Usá incrementos de '+el.step+'.':el.validity.tooShort?'Escribí al menos '+el.minLength+' caracteres.':el.validity.typeMismatch?'Revisá el formato de este campo.':'Revisá el valor ingresado.'
const targets=[[/horario|hora|franja|ventana|disponib|solapa|ocupad/i,'start'],[/duraci/i,'duration'],[/cancha/i,'court'],[/profesor|docente/i,'teacher'],[/tel[eé]fono|whatsapp/i,'phone'],[/cliente|nombre|referente/i,'customer'],[/precio|tarifa|importe/i,'price']]

export default function ValidatedForm({children,onSubmit,error='',className='',...props}) {
  const autoId=useId(), ref=useRef(null), hosts=useRef(new Map()), [issues,setIssues]=useState([])
  function clear(){for(const [el,host] of hosts.current){el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');host.remove()}hosts.current.clear();setIssues([])}
  function show(entries){clear();const next=entries.map(([el,message],i)=>{const host=document.createElement('span');host.id=ref.current.id+'-issue-'+i;host.className='win-field-error';const target=el.closest('[data-field]')||el.closest('label')||el.parentElement;target.append(host);el.setAttribute('aria-invalid','true');el.setAttribute('aria-describedby',host.id);hosts.current.set(el,host);return {host,message,el}});setIssues(next);const first=next[0]?.el;if(first){first.closest('[data-field],label')?.scrollIntoView({block:'center',behavior:'smooth'});first.focus({preventScroll:true})}}
  useEffect(()=>()=>{for(const host of hosts.current.values())host.remove()},[])
  useEffect(()=>{if(!error)return;const form=ref.current, field=targets.find(([pattern])=>pattern.test(error))?.[1];const group=field&&form.querySelector('[data-field="'+field+'"]');const el=group?.querySelector('input:not(:disabled),select:not(:disabled),button:not(:disabled)');if(el)show([[el,error]]);else{form.querySelector('[role="alert"]')?.scrollIntoView({block:'center',behavior:'smooth'})}},[error])
  function submit(e){const elements=Array.from(ref.current.elements).filter(el=>el.willValidate&&!el.validity.valid);if(elements.length){e.preventDefault();show(elements.map(el=>[el,validationMessage(el)]));return}clear();onSubmit?.(e)}
  return <form {...props} id={props.id||autoId} ref={ref} className={'win-validated-form '+className} noValidate onSubmit={submit} onInput={e=>{const host=hosts.current.get(e.target);if(host){host.remove();hosts.current.delete(e.target);e.target.removeAttribute('aria-invalid');e.target.removeAttribute('aria-describedby');setIssues(old=>old.filter(x=>x.el!==e.target))}}}>
    {error&&<p className="win-form-error" role="alert" tabIndex={-1}>{error}</p>}
    {issues.length>0&&<p className="win-sr-only" role="alert">Revisá los campos señalados: {issues.length}.</p>}
    {children}{issues.map((issue,i)=>createPortal(issue.message,issue.host,String(i)))}
  </form>
}
