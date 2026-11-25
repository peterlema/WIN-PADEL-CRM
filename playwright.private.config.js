import {defineConfig,devices} from '@playwright/test'
export default defineConfig({
 testDir:'./scripts/browser',testMatch:'bar-private-accounts.spec.js',fullyParallel:true,
 use:{baseURL:'http://127.0.0.1:5181',trace:'retain-on-failure',viewport:{width:1280,height:800}},
 projects:[{name:'Chrome',use:{...devices['Desktop Chrome'],channel:'chrome'}},{name:'Safari-WebKit',use:{...devices['Desktop Safari']}}],
 webServer:{command:'npm run preview -- --host 127.0.0.1 --port 5181',url:'http://127.0.0.1:5181',reuseExistingServer:false},
 reporter:[['list'],['html',{open:'never'}]],
})
