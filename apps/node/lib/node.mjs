/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import{Service}from'@haus/core/lifecycle';
export class Node {
 constructor({bootstrap}){this.service=new Service(bootstrap);}
 get state(){return this.service.state;}
 start(){return this.service.start();}
 stop(){return this.service.stop();}
}
