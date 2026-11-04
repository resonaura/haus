/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export type ServiceState = 'idle' | 'starting' | 'running' | 'stopping' | 'closed' | 'failed';
export interface RunningService {close():Promise<void>}
export class ResourceScope {
  private releases:(()=>void|Promise<void>)[]=[];
  defer(release:()=>void|Promise<void>){this.releases.push(release);}
  commit(){this.releases=[];}
  async close(){
    const errors:unknown[]=[];
    for(const release of this.releases.splice(0).reverse())try{await release();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'service_cleanup_failed');
  }
}
export type Bootstrap=(context:{signal:AbortSignal;scope:ResourceScope})=>Promise<RunningService>;
/** Owns exactly one start/stop cycle. Concrete applications compose their own bootstraps. */
export class Service {
  private stateValue:ServiceState='idle';
  private readonly controller=new AbortController();
  private starting?:Promise<void>;
  private stopping?:Promise<void>;
  private running?:RunningService;
  constructor(private readonly bootstrap:Bootstrap){}
  get state(){return this.stateValue;}
  start():Promise<void>{
    if(this.starting)return this.starting;
    if(this.stateValue==='running')return Promise.resolve();
    if(this.stateValue!=='idle')return Promise.reject(Error('service_not_startable'));
    this.stateValue='starting';
    const scope=new ResourceScope();
    this.starting=Promise.resolve().then(()=>this.bootstrap({signal:this.controller.signal,scope})).then(async running=>{
      scope.commit();
      if(this.controller.signal.aborted){await running.close();throw Error('service_stopped');}
      this.running=running;this.stateValue='running';
    }).catch(async error=>{
      try{await scope.close();}catch{/* Every remaining release has still been attempted. */}
      if(this.stateValue!=='stopping')this.stateValue='failed';throw error;
    }).finally(()=>{this.starting=undefined;});
    return this.starting;
  }
  stop():Promise<void>{
    if(this.stopping)return this.stopping;
    if(this.stateValue==='closed')return Promise.resolve();
    this.stateValue='stopping';this.controller.abort();
    this.stopping=(async()=>{
      await this.starting?.catch(()=>{});
      const running=this.running;this.running=undefined;
      try{await running?.close();}finally{this.stateValue='closed';}
    })();
    return this.stopping;
  }
}
