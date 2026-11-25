// Detail filters only. Server totals and accounting comparisons are never replaced.
export function financeDetails(rows=[],filters={}){
 return rows.filter(r=>(!filters.financeCategory||r.category===filters.financeCategory)&&(!filters.unit||r.unit===filters.unit)&&(!filters.method||r.method===filters.method))
}
export function activityDetails(rows=[],filters={},teacher=''){
 return rows.filter(r=>(!filters.activityType||r.type===filters.activityType)&&(!filters.court||r.courts?.includes(filters.court))&&(!teacher||r.teacher_id===teacher))
}
export const availableValues=(rows,field)=>[...new Set(rows.flatMap(r=>Array.isArray(r[field])?r[field]:r[field]?[r[field]]:[]))].sort()
