import qs from 'qs'
import type { Handlers } from 'fresh/server.ts'
import { Head } from 'fresh/runtime.ts'
import { Generator } from '@jspm/generator'

const isProduction = Deno.env.get('ENV') === 'production'

const browserMap = await Deno.readTextFile('./importmap.browser.json')

const generator = new Generator({
  inputMap: JSON.parse(browserMap),
  mapUrl: import.meta.url,
  env: [isProduction ? 'production' : 'development', 'browser', 'module'],
})

await generator.reinstall()

export const handler: Handlers = {
  async GET(req, ctx) {
    const response = await ctx.render()
    const html = (await response.body?.getReader().read())?.value
    const htmlString = new TextDecoder().decode(html)
    const injectedHtml = await generator.htmlInject(htmlString, {})
    return new Response(injectedHtml, {
      headers: { 'content-type': 'text/html' },
    })
  },
}

export default function Home(props) {
  console.log(qs.parse(props.url.search.slice(1)))

  return (
    <>
      <Head>
        <title>Fresh App Using JSPM</title>
        <script type="module">
          import qs from 'qs';
          console.log(qs.parse(window.location.search.slice(1)))
        </script>
      </Head>
      <div>
        <p>This is a Fresh app built using JSPM.</p>
      </div>
    </>
  )
}
