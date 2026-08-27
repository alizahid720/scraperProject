import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'LeadForge — Business Lead Intelligence',description:'Discover, enrich, validate and export public business leads.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
