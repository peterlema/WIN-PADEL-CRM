export default function BarTransactionNotice({transaction:t}){
 return <>{t.error&&<p role="alert" className="win-bar-message">{t.error}</p>}{t.notice&&<p role="status" className="win-bar-message good">{t.notice}</p>}{t.uncertain&&<div className="win-bar-warning"><p>Conservamos la misma solicitud. Verificá su resultado antes de volver a operar.</p><button type="button" disabled={t.busy} onClick={()=>t.recover(false)}>Consultar resultado</button>{t.status==='NOT_FOUND'&&<button type="button" disabled={t.busy} onClick={()=>t.recover(true)}>Reintentar misma operación</button>}</div>}</>
}
