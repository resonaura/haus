/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import{expect,it,vi}from'vitest';
import{Service}from'../src/lifecycle.js';
it('coalesces startup and closes a late bootstrap exactly once when shutdown wins',async()=>{
 let ready!:(value:{close:()=>Promise<void>})=>void;
 const close=vi.fn(async()=>{}),bootstrap=vi.fn(()=>new Promise<{close:()=>Promise<void>}>(resolve=>{ready=resolve;}));
 const service=new Service(bootstrap);const first=service.start();expect(service.start()).toBe(first);
 const rejected=expect(first).rejects.toThrow('service_stopped');await vi.waitFor(()=>expect(bootstrap).toHaveBeenCalledTimes(1));
 const stopped=service.stop();expect(service.stop()).toBe(stopped);ready({close});await rejected;await stopped;
 expect(close).toHaveBeenCalledTimes(1);expect(service.state).toBe('closed');await expect(service.start()).rejects.toThrow('not_startable');
});
it('releases constructed resources in reverse order when startup fails without replaying startup',async()=>{
 const released:number[]=[];const bootstrap=vi.fn(async({scope}:Parameters<ConstructorParameters<typeof Service>[0]>[0])=>{scope.defer(()=>{released.push(1);});scope.defer(()=>{released.push(2);});throw Error('bootstrap_failure');});
 const service=new Service(bootstrap);await expect(service.start()).rejects.toThrow('bootstrap_failure');expect(released).toEqual([2,1]);await service.stop();expect(bootstrap).toHaveBeenCalledTimes(1);
});
