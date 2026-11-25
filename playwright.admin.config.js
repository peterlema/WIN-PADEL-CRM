import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./scripts/browser',testMatch:'admin-reports.spec.js',fullyParallel:true,workers:2,retries:0,timeout:45000,
 use:{baseURL:'http://127.0.0.1:5181',viewport:{width:1280,height:800},trace:'retain-on-failure'},
 reporter:[['list'],['html',{open:'never'}]],
 projects:[{name:'chrome',use:{browserName:'chromium',channel:'chrome'}},{name:'webkit',use:{browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5181',url:'http://127.0.0.1:5181',reuseExistingServer:false,timeout:30000}
})
