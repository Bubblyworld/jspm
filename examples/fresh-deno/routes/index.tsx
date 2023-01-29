import qs from 'qs'
import { Head } from 'fresh/runtime.ts'

export default function Home(props) {
  console.log(qs.parse(props.url.search.slice(1)))

  return (
    <>
      <Head>
        <title>Fresh App Using JSPM</title>
      </Head>
      <div>
        <p>
          This is a Fresh app built using JSPM.
        </p>
      </div>
    </>
  )
}
