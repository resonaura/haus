/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export interface HaClientPort{
 request<T>(message:Record<string,unknown>):Promise<T>;
 management<T>(request:{method:'GET'|'POST'|'DELETE';path:string;data?:Record<string,unknown>}):Promise<T>;
}
