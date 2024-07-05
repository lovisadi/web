import { error, fail } from "@sveltejs/kit";
import { redirect } from "$lib/utils/redirect";
import { message, setError, superValidate } from "sveltekit-superforms/server";
import { z } from "zod";
import keycloak from "$lib/server/keycloak";
import type { Actions, PageServerLoad } from "./$types";
import * as m from "$paraglide/messages";
import { languageTag } from "$paraglide/runtime";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { prisma } = locals;
  const position = await prisma.position.findUnique({
    where: {
      id: params.id,
    },
    include: {
      mandates: {
        include: {
          member: true,
        },
        orderBy: [
          {
            member: {
              firstName: "asc",
            },
          },
          {
            member: {
              lastName: "asc",
            },
          },
        ],
      },
      emailAliases: {
        select: {
          email: true,
        },
      },
    },
  });
  if (!position) {
    throw error(404, m.positions_errors_positionNotFound());
  }
  const editedMandateID = url.searchParams.get("editMandate");
  const editedMandate = position.mandates.find((m) => m.id === editedMandateID);
  return {
    updateForm: superValidate(position, updateSchema),
    addMandateForm: superValidate(addManadateSchema),
    updateMandateForm: editedMandate
      ? superValidate(editedMandate, updateMandateSchema)
      : superValidate(updateMandateSchema),
    deleteMandateForm: superValidate(deleteMandateSchema),
    position,
    mandates: position.mandates,
  };
};

const updateSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable(),
  email: z.string().email().nullable(),
});
export type UpdatePositionSchema = typeof updateSchema;

const END_OF_YEAR = new Date(`${new Date().getFullYear()}-12-31T23:59:59`);

const addManadateSchema = z.object({
  memberId: z.string().uuid(),
  startDate: z.coerce.date().default(new Date()),
  endDate: z.coerce.date().default(END_OF_YEAR),
});
export type AddMandateSchema = typeof addManadateSchema;

const updateMandateSchema = z.object({
  mandateId: z.string().uuid(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type UpdateMandateSchema = typeof updateMandateSchema;

const deleteMandateSchema = z.object({
  mandateId: z.string().uuid(),
});
export type DeleteMandateSchema = typeof deleteMandateSchema;

const genitiveCase = (base: string): string => {
  if (languageTag() === "sv") {
    if (base.endsWith("s") || base.endsWith("x")) return base; // Måns or Max => Måns and Max
    else return base + "s"; // Adam => Adams
  } else {
    if (base.endsWith("s")) return base + "'"; // Måns => Måns'
    else return base + "'s"; // Adam => Adam's
  }
};

export const actions: Actions = {
  update: async ({ params, request, locals }) => {
    const { prisma } = locals;
    const form = await superValidate(request, updateSchema);
    if (!form.valid) return fail(400, { form });
    await prisma.position.update({
      where: { id: params.id },
      data: {
        name: form.data.name,
        description: form.data.description,
        email: form.data.email,
      },
    });
    return message(form, {
      message: m.positions_positionUpdated(),
      type: "success",
    });
  },
  addMandate: async ({ params, request, locals }) => {
    const { prisma } = locals;
    const form = await superValidate(request, addManadateSchema);
    if (!form.valid) return fail(400, { form });
    const member = await prisma.member.findUnique({
      where: { id: form.data.memberId },
    });
    if (!member)
      return setError(form, "memberId", m.positions_errors_memberNotFound());
    await prisma.mandate.create({
      data: {
        positionId: params.id,
        memberId: form.data.memberId,
        startDate: form.data.startDate,
        endDate: form.data.endDate,
      },
    });
    keycloak.addMandate(member.studentId!, params.id);
    return message(form, {
      message: m.positions_newMandateGivenTo({
        name: member.firstName ?? m.positions_theMember(),
      }),
      type: "success",
    });
  },
  updateMandate: async (event) => {
    const { params, request, locals } = event;
    const { prisma } = locals;
    const form = await superValidate(request, updateMandateSchema);
    if (!form.valid) return fail(400, { form });
    const member = await prisma.member.findFirst({
      where: {
        mandates: {
          some: {
            id: form.data.mandateId,
          },
        },
      },
    });
    if (!member)
      return message(
        form,
        { message: m.positions_errors_mandateNotFound(), type: "error" },
        { status: 400 },
      );
    await prisma.mandate.update({
      where: { id: form.data.mandateId, positionId: params.id },
      data: {
        startDate: form.data.startDate,
        endDate: form.data.endDate,
      },
    });
    throw redirect(
      `/positions/${params.id}`,
      {
        message: m.positions_mandateUpdated({
          names: genitiveCase(member.firstName ?? m.positions_theMember()),
        }),
        type: "success",
      },
      event,
    );
  },
  deleteMandate: async ({ params, request, locals }) => {
    const { prisma } = locals;
    const form = await superValidate(request, deleteMandateSchema);
    if (!form.valid) return fail(400, { form });
    const member = await prisma.member.findFirst({
      where: {
        mandates: {
          some: {
            id: form.data.mandateId,
          },
        },
      },
    });
    if (!member)
      return message(
        form,
        { message: m.positions_errors_mandateNotFound(), type: "error" },
        { status: 400 },
      );
    await prisma.mandate.delete({
      where: { id: form.data.mandateId, positionId: params.id },
    });
    keycloak.deleteMandate(member.studentId!, params.id);
    return message(form, {
      message: m.positions_mandateRemoved({
        names: genitiveCase(member.firstName ?? m.positions_theMember()),
      }),
      type: "success",
    });
  },
};
