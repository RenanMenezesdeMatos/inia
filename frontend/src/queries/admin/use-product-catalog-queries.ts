import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  approveIdentificationCriterion,
  archiveIdentificationCriterion,
  createIdentificationCriterion,
  createProductNode,
  deleteIdentificationCriterion,
  deleteProductNode,
  discardIdentificationDraft,
  fetchIdentificationCriteria,
  fetchIdentificationCriterion,
  fetchProductNodes,
  fetchProductScopeHistory,
  fetchProductScopeSources,
  reactivateIdentificationCriterion,
  setProductNodeActive,
  setProductScope,
  updateIdentificationCriterion,
  updateProductNode,
} from "@/services/admin/product-catalog-service"
import type { ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { adminQueryKeys } from "./admin-query-keys"

/** Cadastro de produtos: toda mutação invalida o cadastro inteiro (produtos, indícios e bases se referenciam). */
const invalidateKey = adminQueryKeys.productCatalog()

export function useProductNodesQuery() {
  return useQuery({ queryKey: adminQueryKeys.productNodes(), queryFn: fetchProductNodes })
}
export function useIdentificationCriteriaQuery() {
  return useQuery({ queryKey: adminQueryKeys.identificationCriteria(), queryFn: fetchIdentificationCriteria })
}
export function useIdentificationCriterionQuery(id: string | null) {
  return useQuery({ queryKey: adminQueryKeys.identificationCriterion(id ?? ""), queryFn: () => fetchIdentificationCriterion(id!), enabled: Boolean(id) })
}
export function useProductScopeSourcesQuery() {
  return useQuery({ queryKey: adminQueryKeys.productScopeSources(), queryFn: fetchProductScopeSources })
}
export function useProductScopeHistoryQuery(source: Pick<ProductScopeSource, "sourceKind" | "sourceId"> | null) {
  return useQuery({ queryKey: adminQueryKeys.productScopeHistory(source?.sourceKind ?? "", source?.sourceId ?? ""), queryFn: () => fetchProductScopeHistory(source!.sourceKind, source!.sourceId), enabled: Boolean(source) })
}

export function useCreateProductNodeMutation() {
  return useAdminMutation({ mutationFn: createProductNode, invalidateKey, successMessage: "Salvo." })
}
export function useUpdateProductNodeMutation() {
  return useAdminMutation({ mutationFn: updateProductNode, invalidateKey, successMessage: "Alterações salvas." })
}
export function useSetProductNodeActiveMutation() {
  return useAdminMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setProductNodeActive(id, active), invalidateKey, successMessage: "Status atualizado." })
}
export function useDeleteProductNodeMutation() {
  return useAdminMutation({ mutationFn: deleteProductNode, invalidateKey, successMessage: "Excluído." })
}

export function useCreateIdentificationCriterionMutation() {
  return useAdminMutation({ mutationFn: createIdentificationCriterion, invalidateKey, successMessage: "Indício criado como rascunho." })
}
export function useUpdateIdentificationCriterionMutation() {
  return useAdminMutation({ mutationFn: updateIdentificationCriterion, invalidateKey, successMessage: "Rascunho salvo." })
}
export function useApproveIdentificationCriterionMutation() {
  return useAdminMutation({ mutationFn: approveIdentificationCriterion, invalidateKey, successMessage: "Indício aprovado.", silentErrorCodes: ["PRODUCT_CRITERION_NOT_READY"] })
}
export function useDiscardIdentificationDraftMutation() {
  return useAdminMutation({ mutationFn: discardIdentificationDraft, invalidateKey, successMessage: "Rascunho descartado." })
}
export function useArchiveIdentificationCriterionMutation() {
  return useAdminMutation({ mutationFn: archiveIdentificationCriterion, invalidateKey, successMessage: "Indício encerrado." })
}
export function useReactivateIdentificationCriterionMutation() {
  return useAdminMutation({ mutationFn: reactivateIdentificationCriterion, invalidateKey, successMessage: "Indício reativado." })
}
export function useDeleteIdentificationCriterionMutation() {
  return useAdminMutation({ mutationFn: deleteIdentificationCriterion, invalidateKey, successMessage: "Indício excluído." })
}
/** Base de conhecimento: a escolha fica no rascunho e não muda nada em uso. Argumentário: vale a partir de agora. */
export function useSetProductScopeMutation() {
  const queryClient = useQueryClient()
  return useAdminMutation({
    mutationFn: setProductScope,
    invalidateKey,
    onSuccess: (data, variables) => {
      if (variables.kind !== "KNOWLEDGE_DOCUMENT") {
        toast.success("Produtos da base atualizados.")
        return
      }
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.knowledge() })
      if (data.pending) toast.success(`Produtos salvos no rascunho V${data.pending.version}. Só valem quando a versão entrar em uso.`)
      else toast.info("Os produtos já eram estes: nada mudou.")
    },
  })
}
