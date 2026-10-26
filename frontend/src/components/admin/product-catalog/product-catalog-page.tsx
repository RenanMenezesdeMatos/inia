"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { ProductDirectory } from "./product-directory"

/**
 * Produtos (`PRODUCT_APPLICABILITY_V2`): o que a análise das chamadas usa para ligar o pedido do cliente à orientação certa. Uma tela só:
 * a lista de produtos e, para cada um, as bases que valem para ele e os indícios que o reconhecem na chamada. Para quais produtos cada
 * base vale também se escolhe no próprio editor da base e do argumentário ("Vale para"). Sem produtos, a análise funciona como antes.
 */
export function ProductCatalogPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Produtos</CardTitle>
        <CardDescription className="max-w-3xl">
          O mesmo assunto pode ter orientações diferentes por produto. Cadastre os produtos, como reconhecê-los numa chamada e quais bases valem para cada um. Assim a INIA cobra a orientação certa — e, quando a chamada não deixa claro o produto, não cobra regra que
          dependa dele.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProductDirectory />
      </CardContent>
    </Card>
  )
}
