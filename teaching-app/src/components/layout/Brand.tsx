import Image from 'next/image'

export default function Brand({ large = false }: { large?: boolean }) {
  return <span className={`brand${large ? ' brand-large' : ''}`}>
    <Image src="/favicon.svg" alt="" width={large ? 72 : 50} height={large ? 72 : 50} preload={large} />
    <span className="brand-wordmark">PreCalPal</span>
  </span>
}
