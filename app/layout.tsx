import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
const geist=Geist({variable:'--font-geist',subsets:['latin']});
export const metadata:Metadata={title:'LeadForge — Business Lead Intelligence',description:'Discover, enrich, validate and export public business leads.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body className={geist.variable}>{children}</body></html>}
